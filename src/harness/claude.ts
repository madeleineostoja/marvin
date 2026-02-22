import { execa } from "execa";
import { createInterface } from "node:readline";
import type {
  AgentInfo,
  Harness,
  HarnessConfig,
  InvocationHandle,
  ModelUsageEntry,
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

  // Map task tool_use_id → agent info for attribution
  const taskAgents = new Map<string, AgentInfo>();

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
      const parentToolUseId = parsed["parent_tool_use_id"] as string | null | undefined;
      const model = (message?.["model"] as string) ?? "";
      const content = message?.["content"] as
        | Array<Record<string, unknown>>
        | undefined;
      if (!content) {
        continue;
      }

      // Resolve agent info from parent_tool_use_id, attaching actual model
      const baseAgentInfo = parentToolUseId
        ? taskAgents.get(parentToolUseId)
        : undefined;
      const agentInfo = baseAgentInfo
        ? { agent: baseAgentInfo.agent, model: model || baseAgentInfo.model }
        : undefined;

      for (const block of content) {
        const blockType = block["type"] as string | undefined;

        if (blockType === "text") {
          const text = block["text"] as string;
          if (text) {
            yield { type: "text", text, timestamp: Date.now(), agentInfo };
          }
        } else if (blockType === "tool_use") {
          const name = (block["name"] as string).toLowerCase();
          const input = (block["input"] as Record<string, unknown>) ?? {};
          const toolUseId = block["id"] as string | undefined;

          // When the orchestrator calls Task, record the agent mapping
          if (name === "task" && toolUseId && input["subagent_type"]) {
            const agentName = String(input["subagent_type"]).replace(/^marvin-/, "");
            taskAgents.set(toolUseId, { agent: agentName, model: "" });
          }

          yield {
            type: "tool",
            tool: name,
            status: "completed",
            input,
            timestamp: Date.now(),
            agentInfo,
          };
        }
      }
    } else if (lineType === "user") {
      // Extract actual model from subagent tool_use_result
      const toolUseResult = parsed["tool_use_result"] as Record<string, unknown> | undefined;
      const parentToolUseId = parsed["parent_tool_use_id"] as string | null | undefined;
      if (!parentToolUseId && toolUseResult) {
        // This is the orchestrator receiving a task result — extract model from usage
        const usage = toolUseResult["usage"] as Record<string, unknown> | undefined;
        if (usage) {
          // Find the tool_use_id this result belongs to
          const content = (parsed["message"] as Record<string, unknown>)?.["content"] as
            | Array<Record<string, unknown>>
            | undefined;
          const resultBlock = content?.find((b) => b["type"] === "tool_result");
          const resultToolUseId = resultBlock?.["tool_use_id"] as string | undefined;
          if (resultToolUseId) {
            const existing = taskAgents.get(resultToolUseId);
            if (existing) {
              // Extract actual model from modelUsage keys
              const modelUsage = usage["modelUsage"] as Record<string, unknown> | undefined;
              const actualModel = modelUsage ? Object.keys(modelUsage)[0] : "";
              existing.model = actualModel;
            }
          }
        }
      }
    } else if (lineType === "result") {
      // Extract per-model token breakdown from the final result
      // modelUsage is a top-level field on the result event
      const modelUsage = parsed["modelUsage"] as
        | Record<string, Record<string, number>>
        | undefined;
      if (modelUsage) {
        const breakdown: Record<string, ModelUsageEntry> = {};
        for (const [model, usage] of Object.entries(modelUsage)) {
          breakdown[model] = {
            inputTokens: usage["inputTokens"] ?? 0,
            outputTokens: usage["outputTokens"] ?? 0,
            cacheReadTokens: usage["cacheReadInputTokens"] ?? 0,
            cacheCreationTokens: usage["cacheCreationInputTokens"] ?? 0,
          };
        }
        yield { type: "summary", modelUsage: breakdown, timestamp: Date.now() };
      }
    }
    // Ignore "system", "rate_limit_event", and other event types
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
