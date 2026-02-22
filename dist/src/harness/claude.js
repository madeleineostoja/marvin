import { execa } from "execa";
import { createInterface } from "node:readline";
import { claudeAgents, ORCHESTRATOR_PROMPT } from "../agents.js";
const HARD_TIMEOUT_MS = 30 * 60 * 1000;
async function* parseStream(proc) {
    if (!proc.all) {
        return;
    }
    const rl = createInterface({ input: proc.all, crlfDelay: Infinity });
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
        const lineType = parsed["type"];
        if (lineType === "assistant") {
            const message = parsed["message"];
            const content = message?.["content"];
            if (!content) {
                continue;
            }
            for (const block of content) {
                const blockType = block["type"];
                if (blockType === "text") {
                    const text = block["text"];
                    if (text) {
                        yield { type: "text", text, timestamp: Date.now() };
                    }
                }
                else if (blockType === "tool_use") {
                    const name = block["name"].toLowerCase();
                    const input = block["input"] ?? {};
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
export function createClaudeHarness() {
    return {
        name: "claude",
        invoke(config, _iteration, signal) {
            const args = [
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
