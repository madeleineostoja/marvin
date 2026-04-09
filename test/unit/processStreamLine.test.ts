import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processStreamLine } from "../../src/harness/claude.ts";
import type { AgentInfo, StreamEvent } from "../../src/harness/types.ts";

function collect(
  gen: Generator<StreamEvent>,
): StreamEvent[] {
  return [...gen];
}

describe("processStreamLine", () => {
  it("yields text events from assistant messages", () => {
    const taskAgents = new Map<string, AgentInfo>();
    const parsed = {
      type: "assistant",
      message: {
        model: "claude-opus-4-6",
        content: [{ type: "text", text: "hello" }],
      },
      parent_tool_use_id: null,
    };
    const events = collect(processStreamLine(parsed, taskAgents));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "text");
    if (events[0].type === "text") {
      assert.equal(events[0].text, "hello");
      assert.equal(events[0].agentInfo, undefined);
    }
  });

  it("yields tool events from assistant messages", () => {
    const taskAgents = new Map<string, AgentInfo>();
    const parsed = {
      type: "assistant",
      message: {
        model: "claude-opus-4-6",
        content: [
          {
            type: "tool_use",
            id: "tool_123",
            name: "Read",
            input: { file_path: "/foo.ts" },
          },
        ],
      },
      parent_tool_use_id: null,
    };
    const events = collect(processStreamLine(parsed, taskAgents));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "tool");
    if (events[0].type === "tool") {
      assert.equal(events[0].tool, "read");
      assert.equal(events[0].agentInfo, undefined);
    }
  });

  it("registers Agent tool_use in taskAgents map", () => {
    const taskAgents = new Map<string, AgentInfo>();
    const parsed = {
      type: "assistant",
      message: {
        model: "claude-opus-4-6",
        content: [
          {
            type: "tool_use",
            id: "tool_456",
            name: "Agent",
            input: {
              description: "Build feature",
              subagent_type: "marvin-build",
            },
          },
        ],
      },
      parent_tool_use_id: null,
    };
    collect(processStreamLine(parsed, taskAgents));
    assert.equal(taskAgents.size, 1);
    assert.deepEqual(taskAgents.get("tool_456"), {
      agent: "build",
      model: "",
    });
  });

  it("attributes subagent events via parent_tool_use_id", () => {
    const taskAgents = new Map<string, AgentInfo>();
    // First: orchestrator delegates to build
    const delegation = {
      type: "assistant",
      message: {
        model: "claude-opus-4-6",
        content: [
          {
            type: "tool_use",
            id: "tool_parent",
            name: "Agent",
            input: {
              description: "Build feature",
              subagent_type: "marvin-build",
            },
          },
        ],
      },
      parent_tool_use_id: null,
    };
    collect(processStreamLine(delegation, taskAgents));

    // Then: subagent emits a tool call, attributed to the parent
    const subagentCall = {
      type: "assistant",
      message: {
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "tool_use",
            id: "tool_child",
            name: "Edit",
            input: { file_path: "/bar.ts" },
          },
        ],
      },
      parent_tool_use_id: "tool_parent",
    };
    const events = collect(processStreamLine(subagentCall, taskAgents));
    assert.equal(events.length, 1);
    if (events[0].type === "tool") {
      assert.ok(events[0].agentInfo);
      assert.equal(events[0].agentInfo!.agent, "build");
      assert.equal(events[0].agentInfo!.model, "claude-sonnet-4-6");
    }
  });

  it("does NOT register old 'Task' tool name (regression test)", () => {
    const taskAgents = new Map<string, AgentInfo>();
    const parsed = {
      type: "assistant",
      message: {
        model: "claude-opus-4-6",
        content: [
          {
            type: "tool_use",
            id: "tool_old",
            name: "Task",
            input: {
              description: "Build feature",
              subagent_type: "marvin-build",
            },
          },
        ],
      },
      parent_tool_use_id: null,
    };
    collect(processStreamLine(parsed, taskAgents));
    // "task" (lowercased from "Task") should NOT register in taskAgents
    // because the tool was renamed to "Agent" in Claude Code 2.1.63
    assert.equal(taskAgents.size, 0);
  });

  it("yields summary events from result lines", () => {
    const taskAgents = new Map<string, AgentInfo>();
    const parsed = {
      type: "result",
      modelUsage: {
        "claude-opus-4-6": {
          inputTokens: 100,
          outputTokens: 200,
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 25,
        },
      },
    };
    const events = collect(processStreamLine(parsed, taskAgents));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "summary");
  });

  it("ignores system and rate_limit_event types", () => {
    const taskAgents = new Map<string, AgentInfo>();
    assert.equal(
      collect(processStreamLine({ type: "system" }, taskAgents)).length,
      0,
    );
    assert.equal(
      collect(processStreamLine({ type: "rate_limit_event" }, taskAgents))
        .length,
      0,
    );
  });
});
