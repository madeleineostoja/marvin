#!/usr/bin/env node
import { parseArgs } from "node:util";
import { styleText } from "node:util";
import { resolve } from "node:path";
import { loadConfig } from "./src/config.js";
import { runLoop, LoopConfigSchema } from "./src/loop.js";
import { createClaudeHarness } from "./src/harness/claude.js";
import { createOpencodeHarness, isInsideSandbox, runInSandbox, } from "./src/harness/opencode.js";
import { personality } from "./src/personality.js";
import * as ui from "./src/ui.js";
const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
        config: { type: "string" },
        harness: { type: "string" },
        "max-iterations": { type: "string" },
        plan: { type: "string", short: "p" },
        "allow-main": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
});
const planFile = values.plan ?? positionals[0];
if (values.harness && !["claude", "opencode"].includes(values.harness)) {
    console.error(styleText("red", `Unknown harness: ${values.harness}. Must be "claude" or "opencode".`));
    process.exit(1);
}
if (values["max-iterations"] !== undefined) {
    const n = parseInt(values["max-iterations"], 10);
    if (!Number.isFinite(n) || n <= 0) {
        console.error(styleText("red", `Invalid --max-iterations: ${values["max-iterations"]}. Must be a positive integer.`));
        process.exit(1);
    }
}
if (values.help) {
    ui.log("Marvin");
    ui.log(styleText("dim", "Autonomously writing code so you don't have to."));
    ui.blank();
    ui.log("Usage: pnpm marvin [plan] [options]");
    ui.blank();
    ui.log("Options:");
    ui.log("  --config <path>        Config file (default: marvin.json)");
    ui.log("  --harness <name>       claude | opencode (default: from config)");
    ui.log("  -p, --plan <file>      Plan file (overrides config)");
    ui.log("  --max-iterations N     Maximum iterations (default: from config)");
    ui.log("  --allow-main           Skip the main-branch safety check");
    ui.log("  -h, --help             Show this help");
    ui.blank();
    const quoteLines = ui.quoteBlock(personality.help, 60);
    for (const line of quoteLines) {
        ui.log(line);
    }
    process.exit(0);
}
async function main() {
    const workspaceRoot = process.cwd();
    const configPath = resolve(workspaceRoot, values.config ?? "marvin.json");
    const config = await loadConfig(configPath, {
        harness: values.harness,
        plan: planFile,
        maxIterations: values["max-iterations"]
            ? parseInt(values["max-iterations"], 10)
            : undefined,
    });
    if (!config.plan) {
        ui.status("red", "Missing plan");
        ui.log(styleText("dim", "Usage: pnpm marvin <plan.md>"));
        process.exit(1);
    }
    if (config.harness === "opencode" &&
        config.sandbox.enabled &&
        !isInsideSandbox()) {
        await runInSandbox(process.argv.slice(2), {
            domains: config.sandbox.domains,
            workspaceRoot,
        });
        return;
    }
    const harness = config.harness === "claude"
        ? createClaudeHarness()
        : createOpencodeHarness();
    const loopConfig = LoopConfigSchema.parse({
        workspaceRoot,
        planFile: config.plan,
        maxIterations: config.maxIterations,
        preflight: config.preflight,
        models: config.models,
        sandbox: config.sandbox,
        allowMain: values["allow-main"],
    });
    const controller = new AbortController();
    process.on("SIGINT", () => {
        ui.blank();
        if (controller.signal.aborted) {
            ui.log(styleText("dim", "Forced exit."));
            // Remove our handler so the next SIGINT (or this one re-raised) gets
            // the default behaviour (terminate), which still unwinds finally blocks.
            process.removeAllListeners("SIGINT");
            process.kill(process.pid, "SIGINT");
            return;
        }
        ui.log(styleText("dim", "Shutting down... (Ctrl+C again to force)"));
        controller.abort();
    });
    process.on("SIGTERM", () => {
        ui.blank();
        ui.log(styleText("dim", "Received SIGTERM, shutting down..."));
        controller.abort();
    });
    try {
        await runLoop(loopConfig, harness, controller.signal);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ui.blank();
        ui.status("red", "Error");
        ui.log(styleText("dim", message));
        process.exit(1);
    }
}
main();
