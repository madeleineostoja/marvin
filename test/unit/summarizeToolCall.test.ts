import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeToolCall } from "../../src/loop.ts";
import type { StreamEvent } from "../../src/harness/types.ts";

type ToolEvent = Extract<StreamEvent, { type: "tool" }>;

function makeToolEvent(
  tool: string,
  input?: Record<string, unknown>,
): ToolEvent {
  return {
    type: "tool",
    tool,
    status: "completed",
    input,
    timestamp: Date.now(),
  };
}

describe("summarizeToolCall", () => {
  it("formats bash commands with truncation", () => {
    const event = makeToolEvent("bash", {
      command: "echo hello world",
    });
    assert.equal(summarizeToolCall(event), "bash: echo hello world");
  });

  it("truncates long bash commands at 60 chars", () => {
    const longCmd = "a".repeat(80);
    const event = makeToolEvent("bash", { command: longCmd });
    const result = summarizeToolCall(event);
    assert.ok(result.startsWith("bash: "));
    assert.ok(result.endsWith("…"));
    assert.ok(result.length < 70);
  });

  it("formats read with filename only", () => {
    const event = makeToolEvent("read", {
      file_path: "/foo/bar/baz.ts",
    });
    assert.equal(summarizeToolCall(event), "read: baz.ts");
  });

  it("formats glob with pattern", () => {
    const event = makeToolEvent("glob", { pattern: "**/*.ts" });
    assert.equal(summarizeToolCall(event), "glob: **/*.ts");
  });

  it("formats grep with pattern", () => {
    const event = makeToolEvent("grep", { pattern: "TODO" });
    assert.equal(summarizeToolCall(event), "grep: TODO");
  });

  it("formats agent delegation with subagent type", () => {
    const event = makeToolEvent("agent", {
      description: "Implement the feature",
      subagent_type: "marvin-build",
    });
    assert.equal(
      summarizeToolCall(event),
      "agent [build]: Implement the feature",
    );
  });

  it("formats agent delegation without subagent type", () => {
    const event = makeToolEvent("agent", {
      description: "Do something",
    });
    assert.equal(summarizeToolCall(event), "agent: Do something");
  });

  it("truncates long agent descriptions at 50 chars", () => {
    const event = makeToolEvent("agent", {
      description: "A".repeat(60),
      subagent_type: "marvin-build",
    });
    const result = summarizeToolCall(event);
    assert.ok(result.endsWith("…"));
  });

  it("falls through to raw tool name for unknown tools", () => {
    const event = makeToolEvent("webfetch", {});
    assert.equal(summarizeToolCall(event), "webfetch");
  });
});
