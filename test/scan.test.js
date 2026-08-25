import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { explain, scan } from "../src/index.js";

async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
  }
  return root;
}

test("discovers supported files and explains a target", async (context) => {
  const root = await fixture({
    "AGENTS.md": "# Root rules\n- Always use tabs.\n",
    "src/AGENTS.md": "# Source rules\n- Never use tabs.\n",
    ".github/copilot-instructions.md": "# Project rules\n",
    ".github/instructions/typescript.instructions.md": "---\napplyTo: '**/*.ts'\n---\n# TypeScript\n",
    ".agents/skills/review-code/SKILL.md": "---\nname: review-code\ndescription: Review changed code\n---\n# Review\n",
    "skills/release-check/SKILL.md": "---\nname: release-check\ndescription: Check a release\n---\n# Release check\n",
    "src/index.ts": "export {};\n",
    "node_modules/demo/AGENTS.md": "# ignored\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.equal(result.files.length, 6);
  assert.ok(result.diagnostics.some((item) => item.code === "W301"));

  const explained = await explain("src/index.ts", root);
  assert.deepEqual(
    explained.applicable.map((item) => item.path),
    [
      "AGENTS.md",
      ".github/copilot-instructions.md",
      "src/AGENTS.md",
      ".github/instructions/typescript.instructions.md",
    ],
  );
  assert.deepEqual(explained.available.map((item) => item.path), [
    ".agents/skills/review-code/SKILL.md",
    "skills/release-check/SKILL.md",
  ]);
});

test("validates skill metadata and broken local links", async (context) => {
  const root = await fixture({
    ".agents/skills/good-name/SKILL.md": "---\nname: Bad Name\n---\nSee [missing](./missing.md).\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.deepEqual(
    result.diagnostics.map((item) => item.code),
    ["E003", "E004", "W101", "W202"],
  );
});

test("respects root gitignore entries", async (context) => {
  const root = await fixture({
    ".gitignore": "generated/\n",
    "AGENTS.md": "# Included\n",
    "generated/AGENTS.md": "# Ignored\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.deepEqual(result.files.map((item) => item.path), ["AGENTS.md"]);
});

test("accepts nested agentic workflow metadata", async (context) => {
  const root = await fixture({
    ".github/workflows/triage.md": `---
on:
  issues:
    types: [opened]
permissions:
  issues: read
safe-outputs:
  add-comment:
---
Triage the issue.
`,
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.equal(result.diagnostics.length, 0);
});
