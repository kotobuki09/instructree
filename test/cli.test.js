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

test("init creates a GitHub Actions workflow without overwriting it", async (context) => {
  const root = await fixture({});
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = [];

  const exitCode = await run(["init", root], { log: (value) => output.push(value) });
  const workflowPath = path.join(root, ".github", "workflows", "instructree.yml");
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.equal(exitCode, 0);
  assert.equal(output[0], "created .github/workflows/instructree.yml");
  assert.match(workflow, /^name: instruction-lint$/m);
  assert.match(workflow, /uses: kotobuki09\/instructree@v0\.10\.0/);
  assert.match(workflow, /strict: true/);

  await fs.writeFile(workflowPath, "# keep me\n");
  await assert.rejects(() => run(["init", root]), /workflow already exists/);
  assert.equal(await fs.readFile(workflowPath, "utf8"), "# keep me\n");
});

test("init --code-scanning creates a fork-safe SARIF workflow without overwriting it", async (context) => {
  const root = await fixture({});
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = [];

  const exitCode = await run(["init", root, "--code-scanning"], { log: (value) => output.push(value) });
  const workflowPath = path.join(root, ".github", "workflows", "code-scanning.yml");
  const workflow = await fs.readFile(workflowPath, "utf8");

  assert.equal(exitCode, 0);
  assert.equal(output[0], "created .github/workflows/code-scanning.yml");
  assert.match(workflow, /^name: Instructree code scanning$/m);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /security-events: write/);
  assert.match(workflow, /github\.event_name != 'pull_request'/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /npx --yes github:kotobuki09\/instructree#v0\.10\.0 scan \. --sarif > instructree\.sarif/);
  assert.match(workflow, /uses: github\/codeql-action\/upload-sarif@v4/);
  assert.match(workflow, /if: \$\{\{ steps\.scan\.outcome == 'failure' \}\}/);

  await fs.writeFile(workflowPath, "# keep code scanning\n");
  await assert.rejects(() => run(["init", root, "--code-scanning"]), /workflow already exists/);
  assert.equal(await fs.readFile(workflowPath, "utf8"), "# keep code scanning\n");
});

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

test("explain --client codex emits profile metadata without changing neutral JSON", async (context) => {
  const root = await fixture({
    "AGENTS.md": "# Base\n",
    "AGENTS.override.md": "# Override\n",
    "src/app.js": "export {};\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexOutput = [];
  const neutralOutput = [];

  await run(["explain", "src/app.js", "--root", root, "--client", "codex", "--json"], {
    log: (value) => codexOutput.push(value),
  });
  await run(["explain", "src/app.js", "--root", root, "--json"], {
    log: (value) => neutralOutput.push(value),
  });
  process.exitCode = 0;

  const codex = JSON.parse(codexOutput[0]);
  const neutral = JSON.parse(neutralOutput[0]);
  assert.equal(codex.client, "codex");
  assert.equal(codex.profile, "codex");
  assert.deepEqual(codex.applicable.map((item) => item.path), ["AGENTS.override.md"]);
  assert.equal(neutral.client, undefined);
  assert.equal(neutral.profile, undefined);
  assert.deepEqual(neutral.applicable.map((item) => item.path), ["AGENTS.md", "AGENTS.override.md"]);
});

test("rejects unsupported --client values and combinations", async () => {
  await assert.rejects(() => run(["explain", "src/app.js", "--client", "claude"]), /unknown client: claude/);
  await assert.rejects(() => run(["explain", "src/app.js", "--client"]), /--client requires a value/);
  await assert.rejects(() => run(["scan", "--client", "codex"]), /only be used with explain/);
  await assert.rejects(
    () => run(["explain", "src/app.js", "--effective", "--client", "codex"]),
    /--effective and --client cannot be used together/,
  );
});

test("scan SARIF emits GitHub-compatible rules, severities, and relative locations", async (context) => {
  const root = await fixture({
    "AGENTS.md": "@docs/missing.md\n",
    ".agents/skills/wrong/SKILL.md": "---\nname: another-name\ndescription: Review code\n---\n",
  });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = [];
  const exitCode = await run(["scan", root, "--sarif"], { log: (value) => output.push(value) });
  process.exitCode = 0;
  const report = JSON.parse(output[0]);
  const packageJson = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));
  const runReport = report.runs[0];

  assert.equal(exitCode, 1);
  assert.equal(report.$schema, "https://json.schemastore.org/sarif-2.1.0.json");
  assert.equal(report.version, "2.1.0");
  assert.equal(runReport.tool.driver.name, "Instructree");
  assert.equal(runReport.tool.driver.semanticVersion, packageJson.version);
  assert.match(runReport.originalUriBaseIds["%SRCROOT%"].uri, /^file:\/\//);
  assert.match(runReport.originalUriBaseIds["%SRCROOT%"].uri, /\/$/);

  const warning = runReport.results.find((result) => result.ruleId === "W101");
  assert.equal(warning.level, "warning");
  assert.equal(warning.locations[0].physicalLocation.artifactLocation.uri, ".agents/skills/wrong/SKILL.md");
  assert.equal(warning.locations[0].physicalLocation.artifactLocation.uriBaseId, "%SRCROOT%");
  assert.equal(warning.locations[0].physicalLocation.region.startLine, 2);
  assert.equal(runReport.tool.driver.rules[warning.ruleIndex].id, "W101");

  const error = runReport.results.find((result) => result.ruleId === "E403");
  assert.equal(error.level, "error");
  assert.equal(error.message.text, "import target 'docs/missing.md' does not exist");
  assert.equal(error.locations[0].physicalLocation.artifactLocation.uri, "AGENTS.md");
});

test("scan SARIF emits a valid empty results array for a clean repository", async (context) => {
  const root = await fixture({ "AGENTS.md": "# Repository instructions\n" });
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = [];
  const exitCode = await run([root, "--sarif"], { log: (value) => output.push(value) });
  process.exitCode = 0;
  const report = JSON.parse(output[0]);

  assert.equal(exitCode, 0);
  assert.deepEqual(report.runs[0].results, []);
});

test("rejects incompatible or unsupported SARIF options", async () => {
  await assert.rejects(() => run(["scan", "--json", "--sarif"]), /cannot be used together/);
  await assert.rejects(() => run(["imports", "--sarif"]), /only be used with scan/);
  await assert.rejects(() => run(["explain", "AGENTS.md", "--sarif"]), /only be used with scan/);
});

test("rejects code-scanning flag outside init and with init policy options", async () => {
  await assert.rejects(() => run(["scan", "--code-scanning"]), /only be used with init/);
  await assert.rejects(() => run(["init", "--code-scanning", "--strict"]), /init does not accept output or policy options/);
});
