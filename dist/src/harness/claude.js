import { execa } from "execa";
import { createInterface } from "node:readline";
import { claudeAgents, ORCHESTRATOR_PROMPT } from "../agents.js";
const HARD_TIMEOUT_MS = 30 * 60 * 1000;
async function* parseStream(proc) {
    if (!proc.all) {
        return;
    }
    const rl = createInterface({ input: proc.all, crlfDelay: Infinity });
    let current = null;
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
        if (parsed["type"] !== "stream_event") {
            continue;
        }
        const event = parsed["event"];
        if (!event) {
            continue;
        }
        const eventType = event["type"];
        if (eventType === "content_block_start") {
            const block = event["content_block"];
            if (!block) {
                continue;
            }
            const blockType = block["type"];
            if (blockType === "text") {
                current = { type: "text", text: "" };
            }
            else if (blockType === "tool_use") {
                current = {
                    type: "tool_use",
                    name: block["name"],
                    inputJson: "",
                };
            }
        }
        else if (eventType === "content_block_delta") {
            const delta = event["delta"];
            if (!delta || !current) {
                continue;
            }
            const deltaType = delta["type"];
            if (deltaType === "text_delta" && current.type === "text") {
                current.text += delta["text"];
            }
            else if (deltaType === "input_json_delta" &&
                current.type === "tool_use") {
                current.inputJson += delta["partial_json"];
            }
        }
        else if (eventType === "content_block_stop") {
            if (!current) {
                continue;
            }
            if (current.type === "text") {
                yield { type: "text", text: current.text, timestamp: Date.now() };
            }
            else if (current.type === "tool_use") {
                let input = {};
                try {
                    input = JSON.parse(current.inputJson || "{}");
                }
                catch {
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
export function createClaudeHarness() {
    return {
        name: "claude",
        invoke(config, _iteration, signal) {
            const args = [
                "--print",
                "--verbose",
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
