import { execa } from "execa";
import { createInterface } from "node:readline";
import { claudeAgents, ORCHESTRATOR_PROMPT } from "../agents.js";
// Process a single parsed stream-json line. Exported for unit testing — the
// real parseStream below wraps this in a readline iterator over the subprocess
// stdout. The taskAgents map carries state across lines (parent_tool_use_id →
// agent attribution), so callers pass the same map across consecutive calls.
export function* processStreamLine(parsed, taskAgents) {
    const lineType = parsed["type"];
    if (lineType === "assistant") {
        const message = parsed["message"];
        const parentToolUseId = parsed["parent_tool_use_id"];
        const model = message?.["model"] ?? "";
        const content = message?.["content"];
        if (!content) {
            return;
        }
        // Resolve agent info from parent_tool_use_id, attaching actual model
        const baseAgentInfo = parentToolUseId
            ? taskAgents.get(parentToolUseId)
            : undefined;
        const agentInfo = baseAgentInfo
            ? { agent: baseAgentInfo.agent, model: model || baseAgentInfo.model }
            : undefined;
        for (const block of content) {
            const blockType = block["type"];
            if (blockType === "text") {
                const text = block["text"];
                if (text) {
                    yield { type: "text", text, timestamp: Date.now(), agentInfo };
                }
            }
            else if (blockType === "tool_use") {
                const name = block["name"].toLowerCase();
                const input = block["input"] ?? {};
                const toolUseId = block["id"];
                // When the orchestrator calls Agent, record the agent mapping.
                // Tool was renamed Task → Agent in Claude Code 2.1.63.
                if (name === "agent" && toolUseId && input["subagent_type"]) {
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
    }
    else if (lineType === "user") {
        // Extract actual model from subagent tool_use_result
        const toolUseResult = parsed["tool_use_result"];
        const parentToolUseId = parsed["parent_tool_use_id"];
        if (!parentToolUseId && toolUseResult) {
            // This is the orchestrator receiving a task result — extract model from usage
            const usage = toolUseResult["usage"];
            if (usage) {
                // Find the tool_use_id this result belongs to
                const content = parsed["message"]?.["content"];
                const resultBlock = content?.find((b) => b["type"] === "tool_result");
                const resultToolUseId = resultBlock?.["tool_use_id"];
                if (resultToolUseId) {
                    const existing = taskAgents.get(resultToolUseId);
                    if (existing) {
                        // Extract actual model from modelUsage keys
                        const modelUsage = usage["modelUsage"];
                        const actualModel = modelUsage ? Object.keys(modelUsage)[0] : "";
                        existing.model = actualModel;
                    }
                }
            }
        }
    }
    else if (lineType === "result") {
        // Extract per-model token breakdown from the final result
        // modelUsage is a top-level field on the result event
        const modelUsage = parsed["modelUsage"];
        if (modelUsage) {
            const breakdown = {};
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
async function* parseStream(proc) {
    if (!proc.all) {
        return;
    }
    const rl = createInterface({ input: proc.all, crlfDelay: Infinity });
    // Map task tool_use_id → agent info for attribution
    const taskAgents = new Map();
    for await (const line of rl) {
        if (!line.trim()) {
            continue;
        }
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch {
            yield { type: "stderr", text: line, timestamp: Date.now() };
            continue;
        }
        yield* processStreamLine(parsed, taskAgents);
    }
}
export function createClaudeHarness() {
    return {
        name: "claude",
        invoke(config, _iteration, signal) {
            // Isolation flags. Marvin runs claude as an isolated subprocess; we want to
            // strip user-environment leakage as much as the platform allows.
            //
            // - `--strict-mcp-config` (no `--mcp-config`) blocks all MCP servers from
            //   both `~/.claude/` and project `.mcp.json`. Verified empirically.
            // - `--setting-sources project` skips user-level settings (hooks,
            //   permissions, auto-memory). Subscription auth still works.
            // - `--disable-slash-commands` empties the /command list. SKILL.md skills
            //   still load (the flag is misnamed for our purposes), but the build
            //   agent's per-agent `tools` whitelist controls Skill access structurally.
            // - `--disallowedTools` removes specific tools from the entire process.
            //   This cascades to subagents, so we only disallow tools that NEITHER role
            //   should ever use (see list below).
            //
            // Platform constraint worth noting: there is NO mechanism in Claude Code
            // 2.1.97 to give the orchestrator (active session) a more restricted tool
            // surface than its subagents. `--allowedTools` is additive pre-approval,
            // not a whitelist; `--settings` permissions cascade to subagents and have
            // inverted precedence (deny > allow); per-agent `tools` is restrictive
            // for subagents but ignored for the active session agent. So the
            // orchestrator inherits the full process tool surface minus what we strip
            // here, and "orchestrator only edits the plan file" is enforced by prompt +
            // multi-commit tripwire, not structurally. See git history for the spike
            // investigation.
            const disallowedTools = [
                "AskUserQuestion",
                "NotebookEdit",
                "WebFetch",
                "WebSearch",
                "TodoWrite",
                "ToolSearch",
                "EnterPlanMode",
                "ExitPlanMode",
                "EnterWorktree",
                "ExitWorktree",
                "CronCreate",
                "CronDelete",
                "CronList",
                "RemoteTrigger",
                "TaskOutput",
                "TaskStop",
            ].join(" ");
            const args = [
                "--print",
                "--output-format",
                "stream-json",
                "--verbose",
                "--dangerously-skip-permissions",
                "--no-session-persistence",
                "--strict-mcp-config",
                "--setting-sources",
                "project",
                "--disable-slash-commands",
                "--disallowedTools",
                disallowedTools,
                "--model",
                config.models.orchestrator,
                "--append-system-prompt",
                ORCHESTRATOR_PROMPT,
                "--agents",
                JSON.stringify(claudeAgents(config.models)),
            ];
            if (config.sandbox.enabled) {
                args.push("--settings", JSON.stringify({
                    sandbox: {
                        enabled: true,
                        autoAllowBashIfSandboxed: true,
                        network: {
                            allowedDomains: [...config.sandbox.domains],
                        },
                    },
                }));
            }
            args.push(`Plan file: ${config.planFile}`);
            const proc = execa("claude", args, {
                cwd: config.workspaceRoot,
                cancelSignal: signal,
                reject: false,
                all: true,
                buffer: false,
                stdin: "ignore",
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
