#!/usr/bin/env node
/**
 * Smoke test — runs the actual marvin CLI against a dummy plan in a temp
 * directory, then verifies the task was completed, the plan was updated,
 * and everything was committed.
 *
 * Requires: `claude` CLI on PATH with valid credentials.
 *
 * Usage:  pnpm test
 */

import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";

const MARVIN_BIN = resolve(import.meta.dirname, "..", "index.ts");

const PLAN_CONTENT = `# Test Plan

- [ ] Create a file called hello.txt containing "hello world"
`;

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "marvin-test-"));

  try {
    // Minimal git repo (marvin needs git for diff snapshots)
    await execa("git", ["init", dir]);
    await execa("git", ["-C", dir, "commit", "--allow-empty", "-m", "init"]);

    // Write the plan and commit so we can revert later
    const planPath = join(dir, "plan.md");
    await writeFile(planPath, PLAN_CONTENT);
    await execa("git", ["-C", dir, "add", "."]);
    await execa("git", ["-C", dir, "commit", "-m", "add plan"]);

    console.log(`Running marvin in ${dir}...\n`);
    const result = await execa(
      "node",
      [
        "--experimental-strip-types",
        MARVIN_BIN,
        "plan.md",
        "--max-iterations",
        "3",
        "--allow-main",
      ],
      {
        cwd: dir,
        env: process.env,
        stdio: "inherit",
        reject: false,
      },
    );

    if (result.exitCode !== 0) {
      // Dump iteration logs before failing
      const logDir = join(dir, ".marvin", "logs");
      try {
        const logFiles = await readdir(logDir);
        for (const f of logFiles) {
          const content = await readFile(join(logDir, f), "utf-8");
          console.error(`\n── ${f} ──\n${content}`);
        }
      } catch {
        console.error("(no iteration logs found)");
      }
      throw new Error(`Marvin exited with code ${result.exitCode}, expected 0`);
    }

    // Verify marvin created the file with content
    const hello = await readFile(join(dir, "hello.txt"), "utf-8");
    if (!hello.trim()) {
      throw new Error("Expected hello.txt to have content");
    }

    // Verify the plan was updated with the task marked completed
    const updatedPlan = await readFile(planPath, "utf-8");
    if (!updatedPlan.includes("[x]") && !updatedPlan.includes("[X]")) {
      throw new Error(
        `Expected plan to have task checked off, got:\n${updatedPlan}`,
      );
    }

    // Verify iteration logs were written
    const logDir = join(dir, ".marvin", "logs");
    const logFiles = await readdir(logDir);
    if (logFiles.length === 0) {
      throw new Error("Expected at least one iteration log in .marvin/logs/");
    }
    for (const f of logFiles) {
      const content = await readFile(join(logDir, f), "utf-8");
      if (!content.trim()) {
        throw new Error(`Expected log file ${f} to have content`);
      }
    }

    // Verify everything is committed (clean worktree)
    const { stdout: status } = await execa("git", ["-C", dir, "status", "--porcelain"]);
    if (status.trim() !== "") {
      throw new Error(
        `Expected clean worktree after marvin, got:\n${status}`,
      );
    }

    console.log("\n✅ Smoke test passed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("\n❌ Smoke test failed:", err);
  process.exit(1);
});
