import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countIncompleteTasks } from "../../src/loop.ts";

describe("countIncompleteTasks", () => {
  it("counts basic unchecked items", () => {
    const plan = `# Plan
- [ ] Task one
- [ ] Task two
- [x] Task three (done)
`;
    assert.equal(countIncompleteTasks(plan), 2);
  });

  it("returns 0 when all tasks are checked", () => {
    const plan = `# Plan
- [x] Done
- [X] Also done
`;
    assert.equal(countIncompleteTasks(plan), 0);
  });

  it("returns 0 for empty plan", () => {
    assert.equal(countIncompleteTasks(""), 0);
  });

  it("handles indented task items", () => {
    const plan = `# Plan
  - [ ] Indented task
    - [ ] Deeply indented
- [ ] Top-level
`;
    assert.equal(countIncompleteTasks(plan), 3);
  });

  it("handles tab-indented task items", () => {
    const plan = `# Plan
\t- [ ] Tab-indented
`;
    assert.equal(countIncompleteTasks(plan), 1);
  });

  it("does not count checked items with lowercase x", () => {
    const plan = `- [x] done\n- [ ] not done\n`;
    assert.equal(countIncompleteTasks(plan), 1);
  });

  it("does not count checked items with uppercase X", () => {
    const plan = `- [X] done\n- [ ] not done\n`;
    assert.equal(countIncompleteTasks(plan), 1);
  });
});
