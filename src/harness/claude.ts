import { execa } from "execa";
import { createInterface } from "node:readline";
import type {
  Harness,
  HarnessConfig,
  InvocationHandle,
  StreamEvent,
} from "./types.ts";
import { claudeAgents, ORCHESTRATOR_PROMPT } from "../agents.ts";

const HARD_TIMEOUT_MS = 30 * 60 * 1000;

async function* parseStream(
  proc: ReturnType<typeof execa>,
): AsyncGenerator<StreamEvent> {
  if (!proc.all) {
    return;
  }

  const rl = createInterface({ input: proc.all, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      yield { type: "stderr", text: line, timestamp: Date.now() } as const;
      continue;
    }

    const lineType = parsed["type"] as string | undefined;

    if (lineType === "assistant") {
      const message = parsed["message"] as Record<string, unknown> | undefined;
      const content = message?.["content"] as
        | Array<Record<string, unknown>>
        | undefined;
      if (!content) {
        continue;
      }

      for (const block of content) {
        const blockType = block["type"] as string | undefined;

        if (blockType === "text") {
          const text = block["text"] as string;
          if (text) {
            yield { type: "text", text, timestamp: Date.now() };
          }
        } else if (blockType === "tool_use") {
          const name = (block["name"] as string).toLowerCase();
          const input = (block["input"] as Record<string, unknown>) ?? {};
          yield {
            type: "tool",
            tool: name,
            status: "completed",
            input,
            timestamp: Date.now(),
          };
        }
      }
    }
    // Ignore "system", "rate_limit_event", "result", "user", and other event types
  }
}

export function createClaudeHarness(): Harness {
  return {
    name: "claude",
    invoke(
      config: HarnessConfig,
      _iteration: number,
      signal: AbortSignal,
    ): InvocationHandle {
      const args: string[] = [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        "--no-session-persistence",
        "--model",
        config.models.orchestrator,
        "--append-system-prompt",
        ORCHESTRATOR_PROMPT,
        "--agents",
        JSON.stringify(claudeAgents(config.models)),
      ];

      if (config.sandbox.enabled) {
        args.push(
          "--settings",
          JSON.stringify({
            sandbox: {
              enabled: true,
              autoAllowBashIfSandboxed: true,
              network: {
                allowedDomains: [...config.sandbox.domains],
              },
            },
          }),
        );
      }

      args.push(`Execute the next iteration. Plan: ${config.planFile}`);

      const proc = execa("claude", args, {
        cwd: config.workspaceRoot,
        timeout: HARD_TIMEOUT_MS,
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
          CLAUDECODE: undefined,
        },
      });

      return {
        pid: proc.pid,
        events: parseStream(proc),
        result: proc.then((r) => ({ exitCode: r.exitCode ?? null })),
      };
    },
  };
}
