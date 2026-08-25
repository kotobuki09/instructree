import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run } from "../src/cli.js";

async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-cli-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
  }
  return root;
}

test("imports command reports only import-policy failures", async (context) => {
  const root = await fixture({
    ".agents/skills/broken/SKILL.md": "# Missing frontmatter\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = [];
  const exitCode = await run(["imports", root], { log: (value) => output.push(value) });
  process.exitCode = 0;

  assert.equal(exitCode, 0);
  assert.match(output[0], /0 roots/);
  assert.doesNotMatch(output[0], /E002/);
});

test("imports JSON has a focused stable shape", async (context) => {
  const root = await fixture({
    "AGENTS.md": "@docs/base.md\n",
    "docs/base.md": "# Base\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = [];
  const exitCode = await run(["imports", root, "--json"], { log: (value) => output.push(value) });
  process.exitCode = 0;
  const report = JSON.parse(output[0]);

  assert.equal(exitCode, 0);
  assert.equal(report.profile, "github-copilot-cli");
  assert.deepEqual(report.roots, ["AGENTS.md"]);
  assert.equal(report.files, undefined);
  assert.equal(report.edges[0].to, "docs/base.md");
  assert.equal(report.imports[0].to, "docs/base.md");
  assert.deepEqual(report.missingImports, []);
});

test("rejects --effective outside explain", async () => {
  await assert.rejects(() => run(["scan", "--effective"]), /only be used with explain/);
});
