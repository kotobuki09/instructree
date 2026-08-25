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

test("discovers Codex AGENTS.override.md files with directory scope", async (context) => {
  const root = await fixture({
    "AGENTS.md": "# Root rules\n",
    "AGENTS.override.md": "# Root Codex override\n",
    "services/AGENTS.md": "# Service rules\n",
    "services/AGENTS.override.md": "# Service Codex override\n",
    "services/app.js": "export {};\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.deepEqual(
    result.files
      .filter((item) => item.path.endsWith("AGENTS.override.md"))
      .map((item) => ({ path: item.path, family: item.family, kind: item.kind, scope: item.scope })),
    [
      { path: "AGENTS.override.md", family: "Codex", kind: "always", scope: "." },
      { path: "services/AGENTS.override.md", family: "Codex", kind: "always", scope: "services" },
    ],
  );

  const explained = await explain("services/app.js", root);
  assert.deepEqual(
    explained.applicable.map((item) => item.path),
    ["AGENTS.md", "AGENTS.override.md", "services/AGENTS.md", "services/AGENTS.override.md"],
  );
});

test("discovers skills stored as direct children of a catalog root", async (context) => {
  const root = await fixture({
    "review-code/SKILL.md": "---\nname: review-code\ndescription: Review changed code\n---\n# Review\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.deepEqual(result.files.map((item) => item.path), ["review-code/SKILL.md"]);
  assert.equal(result.diagnostics.length, 0);
});

test("keeps cross-client AGENTS.md guidance visible beside Codex overrides", async (context) => {
  const root = await fixture({
    "AGENTS.md": "@docs/base.md\n",
    "AGENTS.override.md": "@missing-codex-only.md\n",
    "docs/base.md": "# Imported base\n",
    "src/AGENTS.md": "# Source instructions\n",
    "src/AGENTS.override.md": "@missing-source-codex-only.md\n",
    "src/index.js": "export {};\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.deepEqual(result.files.map((item) => item.path), [
    "AGENTS.md",
    "AGENTS.override.md",
    "src/AGENTS.md",
    "src/AGENTS.override.md",
  ]);
  assert.deepEqual(result.imports.roots, ["AGENTS.md", "src/AGENTS.md"]);
  assert.deepEqual(result.imports.diagnostics, []);
  assert.equal(result.diagnostics.some((item) => item.code === "W301"), false);

  const explained = await explain("src/index.js", root);
  assert.deepEqual(explained.applicable.map((item) => item.path), [
    "AGENTS.md",
    "AGENTS.override.md",
    "src/AGENTS.md",
    "src/AGENTS.override.md",
  ]);
  assert.deepEqual(explained.effective, [
    { path: "docs/base.md", importedBy: "AGENTS.md", profile: "github-copilot-cli" },
  ]);
});

test("accepts namespaced names in nested skill catalogs", async (context) => {
  const root = await fixture({
    "skills/qdrant-monitoring/debugging/SKILL.md":
      "---\nname: qdrant-monitoring-debugging\ndescription: Debug Qdrant monitoring\n---\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.equal(result.diagnostics.some((item) => item.code === "W101"), false);
});

test("does not treat skill resources as active repository instructions", async (context) => {
  const root = await fixture({
    "template-maker/SKILL.md": "---\nname: template-maker\ndescription: Create instruction templates\n---\n",
    "template-maker/assets/template/AGENTS.md": "@missing-template-variable.md\n",
    "skills/catalog/review-code/SKILL.md":
      "---\nname: catalog-review-code\ndescription: Review code from a nested catalog\n---\n",
    "skills/catalog/review-code/references/AGENTS.md": "@missing-reference.md\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.deepEqual(result.files.map((item) => item.path), [
    "skills/catalog/review-code/SKILL.md",
    "template-maker/SKILL.md",
  ]);
  assert.equal(result.diagnostics.length, 0);
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

test("ignores links and directives inside fenced examples", async (context) => {
  const root = await fixture({
    ".github/instructions/base.instructions.md": "---\napplyTo: '**/*.ts'\n---\nAlways use tabs.\n",
    ".github/instructions/examples.instructions.md": `---
applyTo: '**/*.ts'
---
\`\`\`markdown
Never use tabs.
See [placeholder](./missing.md).
\`\`\`
`,
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.equal(result.diagnostics.some((item) => item.code === "W202"), false);
  assert.equal(result.diagnostics.some((item) => item.code === "W301"), false);
});

test("ignores Markdown link syntax inside inline code examples", async (context) => {
  const root = await fixture({
    ".github/copilot-instructions.md": "Use `[text](relative-url)` when documenting links.\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.equal(result.diagnostics.some((item) => item.code === "W202"), false);
});

test("does not compare directives from disjoint scoped globs", async (context) => {
  const root = await fixture({
    ".github/instructions/csharp.instructions.md": "---\napplyTo: '**/*.cs'\n---\nAlways use records.\n",
    ".github/instructions/dart.instructions.md": "---\napplyTo: '**/*.dart'\n---\nNever use records.\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.equal(result.diagnostics.some((item) => item.code === "W301"), false);
});

test("compares scoped globs that can overlap without sharing a generated witness", async (context) => {
  const root = await fixture({
    ".github/instructions/source.instructions.md": "---\napplyTo: 'src/**'\n---\nAlways use records.\n",
    ".github/instructions/typescript.instructions.md": "---\napplyTo: '**/*.ts'\n---\nNever use records.\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.equal(result.diagnostics.some((item) => item.code === "W301"), true);
});

test("does not treat directive section headings as complete rules", async (context) => {
  const root = await fixture({
    ".github/instructions/base.instructions.md": "---\napplyTo: '**/*.html'\n---\nAlways Use:\n- Semantic HTML\n",
    ".github/instructions/guide.instructions.md": "---\napplyTo: '**/*.html'\n---\nNever Use:\n- Placeholder examples\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.equal(result.diagnostics.some((item) => item.code === "W301"), false);
});

test("does not report aligned alternatives in compound directives as conflicts", async (context) => {
  const root = await fixture({
    ".github/instructions/base.instructions.md": "---\napplyTo: '**/*.ps1'\n---\nUse full cmdlet names.\n",
    ".github/instructions/pester.instructions.md":
      "---\napplyTo: '**/*.ps1'\n---\nAvoid aliases: use full cmdlet names.\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.equal(result.diagnostics.some((item) => item.code === "W301"), false);
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
