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

  type BlockState =
    | { type: "text"; text: string }
    | { type: "tool_use"; name: string; inputJson: string }
    | null;

  let current: BlockState = null;

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

    if (parsed["type"] !== "stream_event") {
      continue;
    }

    const event = parsed["event"] as Record<string, unknown> | undefined;
    if (!event) {
      continue;
    }

    const eventType = event["type"] as string | undefined;

    if (eventType === "content_block_start") {
      const block = event["content_block"] as
        | Record<string, unknown>
        | undefined;
      if (!block) {
        continue;
      }
      const blockType = block["type"] as string | undefined;
      if (blockType === "text") {
        current = { type: "text", text: "" };
      } else if (blockType === "tool_use") {
        current = {
          type: "tool_use",
          name: block["name"] as string,
          inputJson: "",
        };
      }
    } else if (eventType === "content_block_delta") {
      const delta = event["delta"] as Record<string, unknown> | undefined;
      if (!delta || !current) {
        continue;
      }
      const deltaType = delta["type"] as string | undefined;
      if (deltaType === "text_delta" && current.type === "text") {
        current.text += delta["text"] as string;
      } else if (
        deltaType === "input_json_delta" &&
        current.type === "tool_use"
      ) {
        current.inputJson += delta["partial_json"] as string;
      }
    } else if (eventType === "content_block_stop") {
      if (!current) {
        continue;
      }
      if (current.type === "text") {
        yield { type: "text", text: current.text, timestamp: Date.now() };
      } else if (current.type === "tool_use") {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(current.inputJson || "{}");
        } catch {
          input = {};
        }
        yield {
          type: "tool",
          tool: current.name,
          status: "completed",
          input,
          timestamp: Date.now(),
        };
      }
      current = null;
    }
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
