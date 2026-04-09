import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExitStatus } from "../../src/loop.ts";

describe("parseExitStatus", () => {
  it("returns 'blocked' for <marvin>blocked</marvin>", () => {
    assert.equal(
      parseExitStatus("some text\n<marvin>blocked</marvin>\n"),
      "blocked",
    );
  });

  it("returns 'continue' for <marvin>continue</marvin>", () => {
    assert.equal(
      parseExitStatus("some text\n<marvin>continue</marvin>\n"),
      "continue",
    );
  });

  it("defaults to 'continue' when no tag is present", () => {
    assert.equal(parseExitStatus("no tag here"), "continue");
  });

  it("defaults to 'continue' for empty output", () => {
    assert.equal(parseExitStatus(""), "continue");
  });

  it("still parses 'complete' as 'continue' (legacy tag)", () => {
    assert.equal(
      parseExitStatus("<marvin>complete</marvin>"),
      "continue",
    );
  });

  it("finds the tag even with surrounding text", () => {
    const output = `
I've completed the task. Here's my summary...

<marvin>blocked</marvin>
`;
    assert.equal(parseExitStatus(output), "blocked");
  });
});
