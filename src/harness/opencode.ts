import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { styleText } from "node:util";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { personality } from "../personality.ts";
import * as ui from "../ui.ts";
import { ORCHESTRATOR_AGENT, opencodeAgentOverrides, opencodePermissions } from "../agents.ts";
import type {
  Harness,
  HarnessConfig,
  InvocationHandle,
  StreamEvent,
  ToolMetadata,
} from "./types.ts";


const SANDBOX_ENV_KEY = "HYPERFOCAL_SANDBOXED";

export function isInsideSandbox(): boolean {
  return process.env[SANDBOX_ENV_KEY] === "1";
}

export async function runInSandbox(
  args: string[],
  config: { domains: string[]; workspaceRoot: string },
): Promise<void> {
  const { workspaceRoot } = config;
  const logDir = join(workspaceRoot, ".marvin/logs");
  const logPath = join(logDir, "sandbox-violations.log");

  await mkdir(logDir, { recursive: true });

  const gitDir = (
    await execa("git", ["rev-parse", "--git-dir"], { cwd: workspaceRoot })
  ).stdout.trim();
  const resolvedGitDir = resolve(workspaceRoot, gitDir);

  const gitCommonDir = (
    await execa("git", ["rev-parse", "--git-common-dir"], {
      cwd: workspaceRoot,
    })
  ).stdout.trim();
  const resolvedGitCommonDir = resolve(workspaceRoot, gitCommonDir);

  await SandboxManager.initialize(
    {
      allowPty: true,
      ignoreViolations: {
        "*": ["com.apple.SystemConfiguration.DNSConfiguration"],
      },
      network: {
        allowedDomains: config.domains,
        deniedDomains: [],
        allowLocalBinding: true,
      },
      filesystem: {
        denyRead: [
          "~/.ssh",
          "~/.gnupg",
          "~/.aws",
          "~/.kube",
          "~/.config/gh",
          "~/.netrc",
          "~/.npmrc",
        ],
        allowWrite: [
          workspaceRoot,
          resolvedGitDir,
          resolvedGitCommonDir,
          "/tmp",
          "/private/tmp",
          "~/.local/share/opencode",
          "~/.cache",
          "~/Library/pnpm",
          "~/.wrangler",
          "~/.config/sanity",
        ],
        denyWrite: [
          join(workspaceRoot, "marvin"),
          join(workspaceRoot, ".opencode"),
          join(workspaceRoot, "opencode.json"),
        ],
      },
    },
    async ({ host, port }) => {
      const line = `${new Date().toISOString()} [NETWORK] DENIED ${host}:${port ?? 443}\n`;
      await appendFile(logPath, line);
      return false;
    },
    true,
  );

  const forwardArgs = args.filter((arg) => arg !== "--sandbox");
  const quotedArgs = forwardArgs.map((a) => `'${a.replace(/'/g, "'\\''")}'`);
  const command = `node --env-file=.env ./marvin/index.ts ${quotedArgs.join(" ")}`;
  const sandboxedCommand = await SandboxManager.wrapWithSandbox(command);

  return new Promise((resolve) => {
    const child = spawn(sandboxedCommand, {
      shell: true,
      stdio: "inherit",
      cwd: workspaceRoot,
      env: { ...process.env, [SANDBOX_ENV_KEY]: "1" },
      detached: true,
    });

    const killProcessGroup = (signal: NodeJS.Signals): void => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch {}
      }
    };

    const cleanup = async () => {
      const violations =
        SandboxManager.getSandboxViolationStore().getViolations();
      for (const v of violations) {
        if (v.line.includes("network-outbound")) {
          continue;
        }
        const line = `${v.timestamp.toISOString()} [FILESYSTEM] ${v.line}\n`;
        await appendFile(logPath, line).catch(() => {});
      }
      await SandboxManager.reset();
    };

    child.on("exit", async (code) => {
      await cleanup();
      if (code === 0) {
        resolve();
      } else {
        process.exit(code ?? 1);
      }
    });

    child.on("error", async (err) => {
      await cleanup();
      console.log(styleText("red", `Sandbox error: ${err.message}`));
      process.exit(1);
    });

    process.once("SIGINT", () => {
      killProcessGroup("SIGINT");
      ui.blank();
      ui.status("yellow", "Shutting down");
      const quoteLines = ui.quoteBlock(personality.pick(personality.shutdown));
      for (const line of quoteLines) {
        ui.log(line);
      }
      rmSync(join(workspaceRoot, ".marvin/.lock"), { force: true });
      setTimeout(() => {
        killProcessGroup("SIGKILL");
        process.exit(130);
      }, 3000).unref();
    });

    process.once("SIGTERM", () => {
      killProcessGroup("SIGTERM");
      ui.blank();
      ui.status("yellow", "Shutting down");
      const quoteLines = ui.quoteBlock(personality.pick(personality.shutdown));
      for (const line of quoteLines) {
        ui.log(line);
      }
      rmSync(join(workspaceRoot, ".marvin/.lock"), { force: true });
      setTimeout(() => {
        killProcessGroup("SIGKILL");
        process.exit(143);
      }, 3000).unref();
    });
  });
}

type OpencodeTextEvent = {
  type: "text";
  timestamp: number;
  part: { type: "text"; text: string };
};

type OpencodeToolEvent = {
  type: "tool_use";
  timestamp: number;
  part: {
    type: "tool";
    tool: string;
    state: {
      status: string;
      input?: Record<string, unknown>;
      metadata?: {
        output?: string;
        exit?: number;
        truncated?: boolean;
        error?: string;
      };
    };
  };
};

type OpencodeEvent = OpencodeTextEvent | OpencodeToolEvent;

export function createOpencodeHarness(): Harness {
  return {
    name: "opencode",
    invoke(
      config: HarnessConfig,
      _iteration: number,
      signal: AbortSignal,
    ): InvocationHandle {
      const eventQueue: StreamEvent[] = [];
      let resolveNext: ((value: IteratorResult<StreamEvent>) => void) | null =
        null;
      let done = false;

      function pushEvent(event: StreamEvent): void {
        if (resolveNext) {
          const resolve = resolveNext;
          resolveNext = null;
          resolve({ value: event, done: false });
        } else {
          eventQueue.push(event);
        }
      }

      function finish(): void {
        done = true;
        if (resolveNext) {
          const resolve = resolveNext;
          resolveNext = null;
          resolve({ value: undefined as unknown as StreamEvent, done: true });
        }
      }

      const pidRef: { current: number | undefined } = { current: undefined };

      const result = (async () => {
        const configRaw = await readFile(
          join(config.workspaceRoot, "opencode.json"),
          "utf-8",
        );
        const opencodeConfig = JSON.parse(configRaw) as {
          mcp?: Record<string, unknown>;
        };
        const mcpOverrides = Object.fromEntries(
          Object.keys(opencodeConfig.mcp ?? {}).map((key) => [
            key,
            { enabled: false },
          ]),
        );

        const configOverrides = {
          ...opencodeAgentOverrides(config.models),
          mcp: mcpOverrides,
        };
        const permissions = opencodePermissions(config.planFile);

        const proc = execa(
          "opencode",
          [
            "run",
            "--format",
            "json",
            "--agent",
            ORCHESTRATOR_AGENT,
            `Execute the next iteration. Plan: ${config.planFile}`,
          ],
          {
            cwd: config.workspaceRoot,

            cancelSignal: signal,
            reject: false,
            all: true,
            buffer: false,
            stdin: "ignore",
            detached: true,
            forceKillAfterDelay: 5000,
            env: {
              ...process.env,
              NODE_OPTIONS: "--max-old-space-size=2048",
              MARVIN: "1",
              OPENCODE_PERMISSION: JSON.stringify(permissions),
              OPENCODE_CONFIG_CONTENT: JSON.stringify(configOverrides),
            },
          },
        );

        pidRef.current = proc.pid;

        if (proc.all) {
          const rl = createInterface({ input: proc.all });
          for await (const line of rl) {
            try {
              const event = JSON.parse(line) as OpencodeEvent;

              if (event.type === "text") {
                pushEvent({
                  type: "text",
                  text: event.part.text,
                  timestamp: event.timestamp,
                });
              } else if (event.type === "tool_use") {
                const meta = event.part.state.metadata;
                const metadata: ToolMetadata = {
                  output: meta?.output,
                  exitCode: meta?.exit,
                  truncated: meta?.truncated,
                  error: meta?.error,
                };
                pushEvent({
                  type: "tool",
                  tool: event.part.tool,
                  status: event.part.state.status,
                  input: event.part.state.input,
                  metadata,
                  timestamp: event.timestamp,
                });
              }
            } catch {
              pushEvent({ type: "stderr", text: line, timestamp: Date.now() });
            }
          }
        }

        const procResult = await proc;
        finish();
        return { exitCode: procResult.exitCode ?? null };
      })();

      const events: AsyncIterable<StreamEvent> = {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<StreamEvent>> {
              if (eventQueue.length > 0) {
                return Promise.resolve({
                  value: eventQueue.shift()!,
                  done: false,
                });
              }
              if (done) {
                return Promise.resolve({
                  value: undefined as unknown as StreamEvent,
                  done: true,
                });
              }
              return new Promise((resolve) => {
                resolveNext = resolve;
              });
            },
          };
        },
      };

      return {
        get pid() {
          return pidRef.current;
        },
        events,
        result,
      };
    },
  };
}
