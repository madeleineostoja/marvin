import { z } from "zod";
import { execa } from "execa";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { styleText } from "node:util";
import yoctoSpinner from "yocto-spinner";
import { MarvinConfigSchema } from "./config.js";
import { personality } from "./personality.js";
import * as ui from "./ui.js";
async function cleanupIteration(pid) {
    if (!pid) {
        return;
    }
    // execa handles SIGTERM → SIGKILL via cancelSignal + forceKillAfterDelay.
    // Just sweep for any setsid escapees (e.g. Playwright browsers).
    try {
        const survivors = execSync(`pgrep -g ${pid}`, {
            encoding: "utf8",
            timeout: 2000,
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        if (survivors) {
            for (const line of survivors.split("\n")) {
                const p = parseInt(line, 10);
                if (!isNaN(p)) {
                    try {
                        process.kill(p, "SIGKILL");
                    }
                    catch {
                        // already dead
                    }
                }
            }
        }
    }
    catch {
        // pgrep exits 1 when no matches — group is clean
    }
}
export const LoopConfigSchema = MarvinConfigSchema.pick({
    maxIterations: true,
    preflight: true,
    models: true,
    sandbox: true,
}).extend({
    workspaceRoot: z.string(),
    planFile: z.string(),
    allowMain: z.boolean().default(false),
});
const MAX_STALLS = 3;
const LOCK_FILE = ".marvin/.lock";
const LOG_DIR = ".marvin/logs";
function printHeader(config, harness) {
    const artLines = personality.art.active.split("\n");
    const workspaceName = config.workspaceRoot.split("/").pop() || config.workspaceRoot;
    const rightPanel = [];
    rightPanel.push("Marvin");
    rightPanel.push(styleText("dim", "─".repeat(32)));
    rightPanel.push("");
    const quoteText = personality.pick(personality.welcome);
    const quoteLines = ui.quoteBlock(quoteText);
    rightPanel.push(...quoteLines);
    rightPanel.push("");
    rightPanel.push("");
    const infoLines = [
        ui.keyValue("workspace", workspaceName),
        ui.keyValue("iterations", `0 / ${config.maxIterations}`),
        ui.keyValue("harness", harness.name),
        ui.keyValue("sandbox", config.sandbox.enabled ? "on" : "off"),
    ];
    const boxedInfo = ui.dimBox(infoLines);
    rightPanel.push(...boxedInfo);
    const combined = ui.sideBySide(artLines, rightPanel, 4);
    for (const line of combined) {
        ui.log(line);
    }
    ui.rule();
}
function printSummary(iterations, startTime, reason) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    ui.rule();
    ui.blank();
    ui.log("Summary");
    ui.blank();
    ui.log(ui.keyValue("iterations", String(iterations)));
    ui.log(ui.keyValue("elapsed", `${elapsed}s`));
    ui.blank();
    const quoteLines = ui.quoteBlock(personality.pick(personality.summary[reason]));
    for (const line of quoteLines) {
        ui.log(line);
    }
}
function printIterationBanner(iteration) {
    ui.blank();
    ui.labeledRule(`Iteration ${iteration}`);
}
function printMainBranchError() {
    ui.blank();
    ui.status("red", "Error");
    const quoteLines = ui.quoteBlock(personality.pick(personality.errors.mainBranch));
    for (const line of quoteLines) {
        ui.log(line);
    }
    ui.blank();
    ui.log(styleText("dim", "Switch to a feature branch:"));
    ui.log(styleText("dim", "  git checkout -b my-feature-branch"));
}
function printDirtyTreeError() {
    ui.blank();
    ui.status("red", "Dirty worktree");
    const quoteLines = ui.quoteBlock(personality.pick(personality.errors.dirtyTree));
    for (const line of quoteLines) {
        ui.log(line);
    }
    ui.blank();
    ui.log(styleText("dim", "Commit or stash your changes first:"));
    ui.log(styleText("dim", "  git stash        # to stash them"));
    ui.log(styleText("dim", "  git add -A && git commit  # to commit them"));
}
function parseExitStatus(output) {
    const match = output.match(/<marvin>(\w+)<\/marvin>/);
    const status = match?.[1];
    if (status === "complete") {
        return "complete";
    }
    if (status === "blocked") {
        return "blocked";
    }
    return "continue";
}
async function snapshotWorkingTree(cwd) {
    const status = await execa("git", ["status", "--porcelain"], { cwd }).then((r) => r.stdout);
    const diff = await execa("git", ["diff", "HEAD"], { cwd }).then((r) => r.stdout);
    return createHash("md5")
        .update(status + diff)
        .digest("hex");
}
async function isMainBranch(cwd) {
    const branch = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd,
    }).then((r) => r.stdout.trim());
    return branch === "main";
}
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
async function acquireLock(config) {
    const lockPath = join(config.workspaceRoot, LOCK_FILE);
    const release = async () => {
        await rm(lockPath, { force: true });
    };
    try {
        await writeFile(lockPath, String(process.pid), { flag: "wx" });
    }
    catch {
        const existingPid = await readFile(lockPath, "utf-8").catch(() => "unknown");
        const pid = parseInt(existingPid.trim(), 10);
        if (Number.isFinite(pid) && !isPidAlive(pid)) {
            ui.blank();
            ui.status("yellow", "Stale lock", `(PID ${pid} is dead, reclaiming)`);
            await rm(lockPath, { force: true });
            await writeFile(lockPath, String(process.pid), { flag: "wx" });
            return { release };
        }
        ui.blank();
        ui.status("red", "Locked");
        const quoteLines = ui.quoteBlock(personality.pick(personality.errors.locked));
        for (const line of quoteLines) {
            ui.log(line);
        }
        ui.blank();
        ui.log(styleText("dim", `Lock held by PID ${existingPid.trim()} (${LOCK_FILE})`));
        ui.log(styleText("dim", `If stale, delete it: rm ${LOCK_FILE}`));
        process.exit(1);
    }
    return { release };
}
async function setupLogs(config) {
    const logDir = join(config.workspaceRoot, LOG_DIR);
    await rm(logDir, { recursive: true, force: true });
    await mkdir(logDir, { recursive: true });
    // Ensure .marvin/ is ignored by git so logs and lock files don't dirty the worktree
    const gitignorePath = join(config.workspaceRoot, ".marvin", ".gitignore");
    await writeFile(gitignorePath, "*\n");
}
async function runPreflightCheck(config) {
    if (!config.preflight) {
        return;
    }
    const s = yoctoSpinner({
        text: personality.pick(personality.status.preflight),
    }).start();
    try {
        await execa(config.preflight, { cwd: config.workspaceRoot, shell: true });
        s.success("Pre-flight passed");
        const quoteLines = ui.quoteBlock(personality.pick(personality.preflight.passed));
        for (const line of quoteLines) {
            ui.log(line);
        }
    }
    catch {
        s.error("Pre-flight check failed");
        const quoteLines = ui.quoteBlock(personality.pick(personality.preflight.failed));
        for (const line of quoteLines) {
            ui.log(line);
        }
        throw new Error("Pre-flight check failed");
    }
}
function formatElapsed(ms) {
    if (ms < 60000) {
        return `${(ms / 1000).toFixed(0)}s`;
    }
    return `${(ms / 60000).toFixed(1)}m`;
}
function summarizeToolCall(event) {
    const tool = event.tool;
    const input = event.input;
    if (tool === "bash" && input?.["command"]) {
        const cmd = String(input["command"]);
        return `bash: ${cmd.slice(0, 60)}${cmd.length > 60 ? "…" : ""}`;
    }
    if ((tool === "read" || tool === "write" || tool === "edit") &&
        (input?.["file_path"] || input?.["filePath"])) {
        const path = String(input["file_path"] ?? input["filePath"]);
        const name = path.split("/").pop() ?? path;
        return `${tool}: ${name}`;
    }
    if (tool === "glob" && input?.["pattern"]) {
        return `glob: ${input["pattern"]}`;
    }
    if (tool === "grep" && input?.["pattern"]) {
        return `grep: ${input["pattern"]}`;
    }
    if (tool === "task" && input?.["description"]) {
        const desc = String(input["description"]);
        return `task: ${desc.slice(0, 50)}${desc.length > 50 ? "…" : ""}`;
    }
    return tool;
}
function toolPersonality(tool) {
    if (tool === "task") {
        return personality.status.delegating;
    }
    if (["read", "glob", "grep"].includes(tool)) {
        return personality.status.reading;
    }
    if (["write", "edit"].includes(tool)) {
        return personality.status.writing;
    }
    if (tool === "bash") {
        return personality.status.running;
    }
    return personality.status.tool;
}
function formatTimestamp(ts) {
    const date = new Date(ts);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const seconds = date.getSeconds().toString().padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
}
function formatEventStatus(event) {
    if (event.status === "failed") {
        return "failed";
    }
    if (event.metadata?.exitCode !== undefined && event.metadata.exitCode !== 0) {
        return `exit=${event.metadata.exitCode}`;
    }
    if (event.metadata?.truncated) {
        return "truncated";
    }
    return null;
}
export async function runLoop(config, harness, signal) {
    printHeader(config, harness);
    if (!config.allowMain && (await isMainBranch(config.workspaceRoot))) {
        printMainBranchError();
        process.exit(1);
    }
    const dirtyCheck = await execa("git", ["status", "--porcelain"], {
        cwd: config.workspaceRoot,
    }).then((r) => r.stdout.trim());
    if (dirtyCheck) {
        printDirtyTreeError();
        process.exit(1);
    }
    const planPath = join(config.workspaceRoot, config.planFile);
    if (!existsSync(planPath)) {
        ui.blank();
        ui.status("red", "No plan");
        const quoteLines = ui.quoteBlock(personality.pick(personality.errors.noPlan));
        for (const line of quoteLines) {
            ui.log(line);
        }
        ui.blank();
        ui.log(styleText("dim", `Expected at: ${planPath}`));
        process.exit(1);
    }
    await setupLogs(config);
    const lock = await acquireLock(config);
    try {
        await runPreflightCheck(config);
        const ctx = {
            iteration: 0,
            stallCount: 0,
            startTime: Date.now(),
        };
        let exitReason = "completed";
        while (ctx.iteration < config.maxIterations) {
            if (signal.aborted) {
                ui.blank();
                ui.status("yellow", "Shutting down");
                const quoteLines = ui.quoteBlock(personality.pick(personality.shutdown));
                for (const line of quoteLines) {
                    ui.log(line);
                }
                exitReason = "aborted";
                break;
            }
            ctx.iteration++;
            printIterationBanner(ctx.iteration);
            const beforeHash = await snapshotWorkingTree(config.workspaceRoot);
            let result;
            try {
                const iterStart = Date.now();
                const logPath = join(config.workspaceRoot, LOG_DIR, `iteration-${ctx.iteration}.log`);
                const logLines = [];
                const textParts = [];
                let toolCalls = 0;
                logLines.push(`=== Iteration ${ctx.iteration} ===`);
                logLines.push(`Started: ${formatTimestamp(iterStart)}`);
                logLines.push("");
                const harnessConfig = {
                    workspaceRoot: config.workspaceRoot,
                    planFile: config.planFile,
                    models: config.models,
                    sandbox: config.sandbox,
                };
                const handle = harness.invoke(harnessConfig, ctx.iteration, signal);
                const s = yoctoSpinner({
                    text: personality.pick(personality.status.thinking),
                }).start();
                function updateSpinnerText(personalityLines) {
                    s.text = personality.pick(personalityLines);
                }
                for await (const event of handle.events) {
                    if (event.type === "stderr") {
                        logLines.push(`[stderr] ${event.text}`);
                        continue;
                    }
                    else if (event.type === "text") {
                        textParts.push(event.text);
                        const text = event.text.trim();
                        if (text) {
                            for (const textLine of text.split("\n")) {
                                logLines.push(textLine);
                            }
                            logLines.push("");
                        }
                        updateSpinnerText(personality.status.thinking);
                    }
                    else if (event.type === "tool") {
                        toolCalls++;
                        s.stop();
                        const summary = summarizeToolCall(event);
                        ui.detail(`→ ${summary}`);
                        const status = formatEventStatus(event);
                        const statusSuffix = status ? ` (${status})` : "";
                        logLines.push(`  → ${summary}${statusSuffix}`);
                        if (event.metadata?.error) {
                            for (const errorLine of event.metadata.error.split("\n").slice(0, 5)) {
                                logLines.push(`    ${errorLine}`);
                            }
                        }
                        else if (event.metadata?.output && event.status === "failed") {
                            for (const outputLine of event.metadata.output.split("\n").slice(0, 5)) {
                                logLines.push(`    ${outputLine}`);
                            }
                        }
                        updateSpinnerText(toolPersonality(event.tool));
                        s.start();
                    }
                }
                const iterResult = await handle.result;
                await cleanupIteration(handle.pid);
                const elapsedMs = Date.now() - iterStart;
                const fullOutput = textParts.join("");
                logLines.push("── Summary ──────────────────────────────");
                logLines.push(`Tool calls: ${toolCalls} · Elapsed: ${formatElapsed(elapsedMs)}`);
                logLines.push(`Exit code: ${iterResult.exitCode ?? "unknown"}`);
                logLines.push("");
                await writeFile(logPath, logLines.join("\n"));
                if (iterResult.exitCode === 0) {
                    s.success("Done");
                }
                else {
                    s.error("Failed");
                }
                result = {
                    success: iterResult.exitCode === 0,
                    output: fullOutput,
                    elapsedMs,
                    toolCalls,
                };
            }
            catch (error) {
                if (signal.aborted) {
                    exitReason = "aborted";
                    break;
                }
                throw error;
            }
            const afterHash = await snapshotWorkingTree(config.workspaceRoot);
            const diagEl = formatElapsed(result.elapsedMs);
            ui.detail(`${diagEl} · ${result.toolCalls} tool calls`);
            if (!result.success) {
                ui.blank();
                ui.status("red", "Orchestrator failed");
                ui.log(styleText("dim", result.output.slice(-500)));
                exitReason = "blocked";
                break;
            }
            if (beforeHash === afterHash) {
                ctx.stallCount++;
                ui.blank();
                ui.status("yellow", "Stalled", `(${ctx.stallCount}/${MAX_STALLS})`);
                const quoteLines = ui.quoteBlock(personality.pick(personality.stall));
                for (const line of quoteLines) {
                    ui.log(line);
                }
            }
            else {
                ctx.stallCount = 0;
            }
            if (ctx.stallCount >= MAX_STALLS) {
                ui.blank();
                ui.status("yellow", "Stalled");
                const quoteLines = ui.quoteBlock(personality.pick(personality.summary.stalled));
                for (const line of quoteLines) {
                    ui.log(line);
                }
                exitReason = "stalled";
                break;
            }
            const exitStatus = parseExitStatus(result.output);
            if (exitStatus === "complete") {
                ui.blank();
                ui.status("green", "All tasks completed");
                exitReason = "completed";
                break;
            }
            if (exitStatus === "blocked") {
                ui.blank();
                ui.status("yellow", "Blocked");
                const quoteLines = ui.quoteBlock(personality.pick(personality.summary.blocked));
                for (const line of quoteLines) {
                    ui.log(line);
                }
                exitReason = "blocked";
                break;
            }
        }
        printSummary(ctx.iteration, ctx.startTime, exitReason);
        const exitCodes = {
            completed: 0,
            stalled: 1,
            blocked: 2,
            aborted: 3,
        };
        process.exitCode = exitCodes[exitReason];
    }
    finally {
        await lock.release();
    }
}
