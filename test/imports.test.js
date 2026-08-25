import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findImportReferences } from "../src/imports.js";
import { explain, scan } from "../src/index.js";

async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-imports-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
  }
  return root;
}

test("finds line imports but ignores fenced examples", () => {
  const references = findImportReferences(`@docs/live.md

\`\`\`markdown
@docs/example-only.md
\`\`\`

  @docs/also-live.md
`);
  assert.deepEqual(references, [
    { raw: "docs/live.md", line: 1 },
    { raw: "docs/also-live.md", line: 7 },
  ]);
});

test("builds a recursive import graph and reports unsafe edges", async (context) => {
  const root = await fixture({
    "AGENTS.md": `# Rules
@docs/base.md
@docs/shared.md
@missing.md
@../outside.md
@C:\\private.md
`,
    "docs/base.md": "@nested.md\n@shared.md\n",
    "docs/nested.md": "@base.md\n",
    "docs/shared.md": "# Shared\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.deepEqual(result.imports.roots, ["AGENTS.md"]);
  assert.deepEqual(result.imports.effectiveFiles["AGENTS.md"], [
    "AGENTS.md",
    "docs/base.md",
    "docs/nested.md",
    "docs/shared.md",
  ]);
  assert.deepEqual(
    result.imports.diagnostics.map((item) => item.code).sort(),
    ["E401", "E402", "E403", "E405", "I401"],
  );
  assert.deepEqual(result.imports.cycles, [["docs/base.md", "docs/nested.md", "docs/base.md"]]);
  assert.equal(result.imports.missingImports[0].raw, "missing.md");
  assert.deepEqual(
    result.imports.blockedImports.map((edge) => edge.status).sort(),
    ["absolute", "outside"],
  );
});

test("adds transitive imports to effective path explanations", async (context) => {
  const root = await fixture({
    "AGENTS.md": "@docs/base.md\n",
    "docs/base.md": "@shared.md\n",
    "docs/shared.md": "# Shared\n",
    "src/index.js": "export {};\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await explain("src/index.js", root);
  assert.deepEqual(result.effective, [
    { path: "docs/base.md", importedBy: "AGENTS.md", profile: "github-copilot-cli" },
    { path: "docs/shared.md", importedBy: "AGENTS.md", profile: "github-copilot-cli" },
  ]);
});

test("does not expand references from path-scoped instructions", async (context) => {
  const root = await fixture({
    ".github/instructions/javascript.instructions.md": "---\napplyTo: '**/*.js'\n---\n@missing.md\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.deepEqual(result.imports.roots, []);
  assert.equal(result.imports.diagnostics.length, 0);
});

test("does not expand references from Codex AGENTS.override.md files", async (context) => {
  const root = await fixture({
    "AGENTS.override.md": "@missing-codex-only.md\n",
    "src/app.js": "export {};\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await scan(root);
  assert.deepEqual(result.imports.roots, []);
  assert.deepEqual(result.imports.diagnostics, []);
});

test("rejects an in-repository symlink whose target escapes the repository", async (context) => {
  const root = await fixture({ "AGENTS.md": "@linked.md\n" });
  const outside = await fixture({ "outside.md": "# Outside\n" });
  context.after(() => Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(outside, { recursive: true, force: true }),
  ]));

  try {
    await fs.symlink(path.join(outside, "outside.md"), path.join(root, "linked.md"), "file");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) {
      context.skip("file symlinks are unavailable on this host");
      return;
    }
    throw error;
  }

  const result = await scan(root);
  assert.equal(result.imports.edges[0].status, "outside");
  assert.equal(result.imports.diagnostics[0].code, "E402");
});
