import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAction } from "../src/action.js";

async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-action-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
  }
  return root;
}

test("action emits GitHub annotations and fails on errors", async (context) => {
  const root = await fixture({
    ".agents/skills/broken/SKILL.md": "# Missing frontmatter\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = [];

  const exitCode = await runAction(
    { GITHUB_WORKSPACE: root, INPUT_ROOT: ".", INPUT_STRICT: "false" },
    { log: (value) => output.push(value) },
  );

  assert.equal(exitCode, 1);
  assert.match(
    output[0],
    /^::error file=.agents\/skills\/broken\/SKILL.md,line=1,title=Instructree E002::skill files require YAML frontmatter$/,
  );
});

test("action rejects roots outside the workspace", async (context) => {
  const root = await fixture({ "AGENTS.md": "# Rules\n" });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = [];

  const exitCode = await runAction(
    { GITHUB_WORKSPACE: root, INPUT_ROOT: "..", INPUT_STRICT: "false" },
    { log: (value) => output.push(value) },
  );

  assert.equal(exitCode, 2);
  assert.equal(output[0], "::error title=Instructree::root must be inside GITHUB_WORKSPACE");
});

test("action fails warnings only in strict mode", async (context) => {
  const root = await fixture({
    "skills/folder-name/SKILL.md": "---\nname: different-name\ndescription: Demonstrate a warning\n---\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = [];

  const normalExit = await runAction(
    { GITHUB_WORKSPACE: root, INPUT_ROOT: ".", INPUT_STRICT: "false" },
    { log: (value) => output.push(value) },
  );
  const strictExit = await runAction(
    { GITHUB_WORKSPACE: root, INPUT_ROOT: ".", INPUT_STRICT: "true" },
    { log: (value) => output.push(value) },
  );

  assert.equal(normalExit, 0);
  assert.equal(strictExit, 1);
  assert.match(output[0], /^::warning file=skills\/folder-name\/SKILL.md,line=2,title=Instructree W101::/);
});

test("action validates boolean inputs", async (context) => {
  const root = await fixture({ "AGENTS.md": "# Rules\n" });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = [];

  const exitCode = await runAction(
    { GITHUB_WORKSPACE: root, INPUT_ROOT: ".", INPUT_STRICT: "sometimes" },
    { log: (value) => output.push(value) },
  );

  assert.equal(exitCode, 2);
  assert.equal(output[0], "::error title=Instructree::strict must be 'true' or 'false'");
});
