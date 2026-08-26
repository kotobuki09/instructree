import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseCodexSkillsConfig } from "../src/codex-config.js";
import { auditCodexSkills } from "../src/index.js";
import { run } from "../src/cli.js";

async function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
  }
}

function estimatedSkillLine(skill) {
  const name = skill.name ?? "(unnamed)";
  const sourceDescription = Array.from(skill.description ?? "");
  const description = sourceDescription.length > 1024
    ? `${sourceDescription.slice(0, 1021).join("")}...`
    : sourceDescription.join("");
  return description
    ? `- ${name}: ${description} (file: ${skill.path})\n`
    : `- ${name}: (file: ${skill.path})\n`;
}

test("audits Codex user and repository skill scopes without exposing absolute paths", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-skills-"));
  const repository = path.join(temporary, "repo");
  const home = path.join(temporary, "home");
  const cwd = path.join(repository, "nested", "deep");
  await writeFiles(repository, {
    ".git/HEAD": "ref: refs/heads/main\n",
    ".agents/skills/repo-skill/SKILL.md": "---\nname: repo-skill\ndescription: Repository helper.\n---\n",
    "nested/.agents/skills/shared-copy/SKILL.md": "---\nname: shared\ndescription: >-\n  Nested duplicate.\n---\n",
  });
  await writeFiles(home, {
    ".agents/skills/shared/SKILL.md": "---\nname: shared\ndescription: User helper.\n---\n",
    ".agents/skills/bad/SKILL.md": "---\nname: bad\n---\n",
  });
  await fs.mkdir(cwd, { recursive: true });
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const result = await auditCodexSkills(cwd, home);
  assert.equal(result.client, "codex");
  assert.equal(result.repository.currentDirectory, "nested/deep");
  assert.deepEqual(result.scopes.map((scope) => scope.path), [
    "~/.agents/skills",
    "~/.codex/skills",
    "nested/deep/.agents/skills",
    "nested/.agents/skills",
    ".agents/skills",
  ]);
  assert.deepEqual(result.skills.map((skill) => skill.name), ["bad", "shared", "shared", "repo-skill"]);
  assert.equal(result.duplicates[0].name, "shared");
  assert.equal(result.duplicates[0].crossScope, true);
  assert.deepEqual(result.duplicates[0].occurrences.map((occurrence) => occurrence.line), [2, 2]);
  assert.equal(result.skills.find((skill) => skill.path === "nested/.agents/skills/shared-copy/SKILL.md").description, "Nested duplicate.");
  assert.equal(result.metadataFailures[0].field, "description");
  assert.equal(result.metadataFailures[0].path, "~/.agents/skills/bad/SKILL.md");
  assert.equal(result.pressure.unknownContextWindowReferenceChars, 8000);
  assert.equal(result.pressure.status, "within-unknown-window-reference");
  const estimatedNames = result.skills.reduce((total, skill) => total + Array.from(skill.name ?? "(unnamed)").length, 0);
  const estimatedDescriptions = result.skills.reduce((total, skill) => total + Math.min(Array.from(skill.description ?? "").length, 1024), 0);
  const estimatedPaths = result.skills.reduce((total, skill) => total + Array.from(skill.path).length, 0);
  const estimatedInitialList = result.skills.reduce((total, skill) => total + Array.from(estimatedSkillLine(skill)).length, 0);
  assert.equal(result.pressure.estimatedNameChars, estimatedNames);
  assert.equal(result.pressure.estimatedDescriptionChars, estimatedDescriptions);
  assert.equal(result.pressure.estimatedPathChars, estimatedPaths);
  assert.equal(result.pressure.estimatedInitialListChars, estimatedInitialList);
  assert.equal(result.configuration.status, "missing");
  assert.equal(result.skills.every((skill) => skill.configuredEnabled), true);
  assert.equal(result.pressure.configuredEstimatedInitialListChars, result.pressure.estimatedInitialListChars);
  assert.match(result.pressure.note, /2%/);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(home), false);
  assert.equal(serialized.includes(repository), false);
});

test("parses the supported Codex skill-config subset and trims name selectors", () => {
  const parsed = parseCodexSkillsConfig(`[skills] # inline comment
include_instructions = false

[[skills.config]]
name = "  alpha  "
enabled = false
`);

  assert.equal(parsed.status, "parsed");
  assert.equal(parsed.settings.includeInstructions, false);
  assert.deepEqual(parsed.rules, [{ selector: "name", value: "alpha", enabled: false, line: 5 }]);
  assert.deepEqual(parsed.issues, []);
});

test("marks unsupported skill config forms instead of partially interpreting them", () => {
  const cases = [
    "\uFEFF[skills]\ninclude_instructions = false\n",
    "skills = { include_instructions = false }\n",
    "[skills]\ninclude_instructions = true\ninclude_instructions = false\n",
    "[[skills.config]]\nname = 'alpha'\n",
    "[[skills.config]]\npath = 'relative/SKILL.md'\nenabled = false\n",
    "[[skills.config]]\nname = [\"alpha\"]\nenabled = false\n",
  ];

  for (const content of cases) {
    assert.equal(parseCodexSkillsConfig(content).status, "unsupported");
  }
});

test("labels an overlong approximate initial list against the unknown-window reference", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-skills-pressure-"));
  const repository = path.join(temporary, "repo");
  const files = { ".git/HEAD": "ref: refs/heads/main\n" };
  for (let index = 1; index <= 8; index += 1) {
    files[`.agents/skills/large-${index}/SKILL.md`] = `---\nname: large-${index}\ndescription: ${"x".repeat(2000)}\n---\n`;
  }
  await writeFiles(repository, files);
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const result = await auditCodexSkills(repository, path.join(temporary, "home"));
  assert.equal(result.pressure.status, "exceeds-unknown-window-reference");
  assert.ok(result.pressure.estimatedInitialListChars > result.pressure.unknownContextWindowReferenceChars);
});

test("ranks the largest configured contributors using the current Codex description cap", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-skills-contributors-"));
  const repository = path.join(temporary, "repo");
  const home = path.join(temporary, "home");
  await writeFiles(repository, { ".git/HEAD": "ref: refs/heads/main\n" });
  await writeFiles(home, {
    ".agents/skills/heavy/SKILL.md": `---\nname: heavy\ndescription: ${"h".repeat(1500)}\n---\n`,
    ".agents/skills/medium/SKILL.md": `---\nname: medium\ndescription: ${"m".repeat(500)}\n---\n`,
    ".agents/skills/small/SKILL.md": "---\nname: small\ndescription: Small helper.\n---\n",
    ".agents/skills/disabled-heavy/SKILL.md": `---\nname: disabled-heavy\ndescription: ${"d".repeat(1800)}\n---\n`,
    ".codex/config.toml": "[[skills.config]]\nname = \"disabled-heavy\"\nenabled = false\n",
  });
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const result = await auditCodexSkills(repository, home);
  assert.deepEqual(result.pressure.topConfiguredContributors.map((item) => item.name), ["heavy", "medium", "small"]);
  assert.equal(result.pressure.topConfiguredContributors[0].descriptionChars, 1024);
  assert.equal(result.pressure.topConfiguredContributors[0].descriptionTruncated, true);
  assert.equal(result.pressure.topConfiguredContributors.some((item) => item.name === "disabled-heavy"), false);
  assert.match(result.pressure.estimateModel, /1,024/);
  assert.match(result.provenance.renderSource, /9b4a0f8a0a60349ecfcc3c32d1dd050ce2efc253/);

  const output = [];
  await run(["skills", repository, "--home", home], { log: (value) => output.push(value) });
  process.exitCode = 0;
  assert.match(output[0], /largest configured contributors · top 3 of 3/);
  assert.match(output[0], /heavy · \d+ chars/);
  assert.equal(output[0].includes(temporary), false);
});

test("reports one precise metadata failure for a BOM-prefixed Codex skill", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-skills-bom-"));
  const repository = path.join(temporary, "repo");
  const home = path.join(temporary, "home");
  await writeFiles(repository, {
    ".git/HEAD": "ref: refs/heads/main\n",
    ".agents/skills/bom-skill/SKILL.md": "\uFEFF---\nname: bom-skill\ndescription: Valid metadata behind a BOM.\n---\n",
  });
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const result = await auditCodexSkills(repository, home);
  assert.equal(result.skills[0].name, "bom-skill");
  assert.equal(result.skills[0].description, "Valid metadata behind a BOM.");
  assert.deepEqual(result.metadataFailures.map((item) => item.code), ["unsupported-utf8-bom"]);
  assert.match(result.metadataFailures[0].message, /UTF-8 BOM/);
  assert.match(result.metadataFailures[0].message, /without BOM/);
});

test("resolves user Codex skill rules with later-rule precedence and redacted paths", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-skills-config-"));
  const repository = path.join(temporary, "repo");
  const home = path.join(temporary, "home");
  const localOnly = path.join(repository, ".agents", "skills", "local-only", "SKILL.md");
  await writeFiles(repository, {
    ".git/HEAD": "ref: refs/heads/main\n",
    ".agents/skills/local-shared/SKILL.md": "---\nname: shared\ndescription: Local shared skill.\n---\n",
    ".agents/skills/local-only/SKILL.md": "---\nname: local-only\ndescription: Disable by exact path.\n---\n",
  });
  await writeFiles(home, {
    ".agents/skills/global-shared/SKILL.md": "---\nname: shared\ndescription: Global shared skill.\n---\n",
    ".codex/config.toml": `[skills]
include_instructions = true
max_context_tokens = 2048

[skills.bundled]
enabled = false

[[skills.config]]
name = "shared"
enabled = false

[[skills.config]]
name = "ghost"
enabled = false

[[skills.config]]
name = "shared"
enabled = true

[[skills.config]]
path = ${JSON.stringify(localOnly)}
enabled = false

[[skills.config]]
name = "ignored"
path = ${JSON.stringify(localOnly)}
enabled = false

[[skills.config]]
name = "   "
enabled = false
`,
  });
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const result = await auditCodexSkills(repository, home);
  const byName = Object.fromEntries(result.skills.map((skill) => [skill.name, skill]));
  assert.equal(result.configuration.status, "parsed");
  assert.deepEqual(result.configuration.settings, {
    includeInstructions: true,
    maxContextTokens: 2048,
    bundledEnabled: false,
  });
  assert.equal(result.configuration.effectiveRuleCount, 3);
  assert.equal(result.configuration.matchedRuleCount, 2);
  assert.equal(result.configuration.unmatchedRuleCount, 1);
  assert.deepEqual(result.configuration.unmatchedRules.map((rule) => rule.value), ["ghost"]);
  assert.deepEqual(result.configuration.issues.map((issue) => issue.code), ["invalid-selector", "blank-selector"]);
  assert.equal(byName.shared.configuredEnabled, true);
  assert.equal(byName["local-only"].configuredEnabled, false);
  assert.deepEqual(result.configuration.disabledSkills.map((skill) => skill.name), ["local-only"]);
  assert.ok(result.pressure.configuredEstimatedInitialListChars < result.pressure.estimatedInitialListChars);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(temporary), false);
  assert.equal(serialized.includes(localOnly), false);

  const output = [];
  await run(["skills", repository, "--home", home], { log: (value) => output.push(value) });
  process.exitCode = 0;
  assert.match(output[0], /user config · ~\/\.codex\/config\.toml/);
  assert.match(output[0], /3 effective · 2 matched · 1 disabled · 1 unmatched/);
  assert.match(output[0], /local-only/);
  assert.doesNotMatch(output[0], new RegExp(temporary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("fails closed on unsupported user skill config and does not apply project rules", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-skills-config-unsupported-"));
  const repository = path.join(temporary, "repo");
  const home = path.join(temporary, "home");
  await writeFiles(repository, {
    ".git/HEAD": "ref: refs/heads/main\n",
    ".agents/skills/project-skill/SKILL.md": "---\nname: project-skill\ndescription: Project skill.\n---\n",
    ".codex/config.toml": "[[skills.config]]\nname = 'project-skill'\nenabled = false\n",
  });
  await writeFiles(home, {
    ".codex/config.toml": "[skills]\ninclude_instructions = false\n\n[[skills.config]]\nname = [\"project-skill\"]\nenabled = false\n",
  });
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const result = await auditCodexSkills(repository, home);
  assert.equal(result.configuration.status, "unsupported");
  assert.equal(result.configuration.settings.includeInstructions, null);
  assert.ok(result.configuration.issues.some((issue) => issue.code === "unsupported-value"));
  assert.equal(result.skills[0].configuredEnabled, true);
  assert.equal(result.configuration.disabledSkills.length, 0);
  assert.equal(result.pressure.configuredEstimatedInitialListChars, result.pressure.estimatedInitialListChars);
  assert.equal(JSON.stringify(result).includes(temporary), false);
});

test("skills CLI emits deterministic JSON and exposes the audit in help", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-skills-cli-"));
  const repository = path.join(temporary, "repo");
  const home = path.join(temporary, "home");
  const cwd = path.join(repository, "nested");
  await writeFiles(repository, {
    ".git/HEAD": "ref: refs/heads/main\n",
    ".agents/skills/repo-skill/SKILL.md": "---\nname: repo-skill\ndescription: Repository helper.\n---\n",
    ".agents/skills/clean/SKILL.md": "---\nname: clean\ndescription: Clean repository helper.\n---\n",
    "nested/.agents/skills/repo-copy/SKILL.md": "---\nname: repo-skill\ndescription: Nested copy.\n---\n",
    "nested/.agents/skills/mismatch/SKILL.md": "---\nname: another-name\ndescription: Mismatched folder.\n---\n",
  });
  await fs.mkdir(cwd, { recursive: true });
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const first = [];
  const second = [];
  const implicit = [];
  const omittedCwd = [];
  const human = [];
  const expanded = [];
  const exitCode = await run(["skills", cwd, "--home", home, "--client", "codex", "--json"], { log: (value) => first.push(value) });
  await run(["skills", cwd, "--home", home, "--client", "codex", "--json"], { log: (value) => second.push(value) });
  await run(["skills", cwd, "--home", home, "--json"], { log: (value) => implicit.push(value) });
  await run(["skills", cwd, "--home", home], { log: (value) => human.push(value) });
  await run(["skills", cwd, "--home", home, "--all"], { log: (value) => expanded.push(value) });
  const originalCwd = process.cwd();
  try {
    process.chdir(cwd);
    await run(["skills", "--home", home, "--json"], { log: (value) => omittedCwd.push(value) });
  } finally {
    process.chdir(originalCwd);
  }
  const help = [];
  await run(["--help"], { log: (value) => help.push(value) });
  process.exitCode = 0;

  assert.equal(exitCode, 0);
  assert.equal(first[0], second[0]);
  assert.equal(first[0], implicit[0]);
  assert.match(help[0], /instructree skills \[cwd\] \[--home <home>\] \[--client codex\] \[--all \| --json\]/);
  assert.equal(JSON.parse(omittedCwd[0]).repository.currentDirectory, "nested");
  assert.ok(JSON.parse(first[0]).skills.some((skill) => skill.name === "repo-skill"));
  assert.equal(JSON.parse(first[0]).duplicates[0].occurrences[0].line, 2);
  assert.match(human[0], /possible duplicate skill names/);
  assert.match(human[0], /repo-skill\/SKILL\.md:2/);
  assert.match(human[0], /metadata warnings/);
  assert.match(human[0], /largest configured contributors/);
  assert.match(human[0], /clean\/SKILL\.md/);
  assert.match(expanded[0], /clean\/SKILL\.md/);
  assert.match(human[0], /2 skill candidates · full inventory omitted/);
  await assert.rejects(() => run(["skills", cwd, "--client", "claude"]), /unknown client: claude/);
  await assert.rejects(() => run(["skills", cwd, "--strict"]), /audit signals are report data/);
  await assert.rejects(() => run(["scan", repository, "--all"]), /--all can only be used with skills/);
  await assert.rejects(() => run(["skills", cwd, "--all", "--json"]), /--all and --json cannot be used together/);
  assert.deepEqual(JSON.parse(first[0]).provenance.limitations, [
    "Does not include Codex admin or system skills.",
    "Audits the default deprecated ~/.codex/skills location; a custom CODEX_HOME is not resolved.",
    "Reads only supported skill settings from user ~/.codex/config.toml; session flags and project config are not applied.",
    "Uses the nearest .git marker rather than configured Codex project-root markers.",
    "Reports user-configured candidate state, not the exact skills loaded after plugins, product restrictions, or session overrides.",
  ]);
});

test("follows symlinked Codex skill folders", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-skills-link-"));
  const repository = path.join(temporary, "repo");
  const home = path.join(temporary, "home");
  const source = path.join(repository, "shared-skill");
  const link = path.join(repository, ".agents", "skills", "linked");
  await writeFiles(repository, {
    ".git/HEAD": "ref: refs/heads/main\n",
    "shared-skill/SKILL.md": "---\nname: linked\ndescription: Linked helper.\n---\n",
  });
  await fs.mkdir(path.dirname(link), { recursive: true });
  try {
    await fs.symlink(source, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    context.skip(`symlinks unavailable on this host: ${error.code ?? error.message}`);
    await fs.rm(temporary, { recursive: true, force: true });
    return;
  }
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const result = await auditCodexSkills(repository, home);
  assert.deepEqual(result.skills.map((skill) => skill.path), [".agents/skills/linked/SKILL.md"]);
  assert.equal(result.skills[0].name, "linked");
  assert.equal(result.skills[0].symlinked, true);
  assert.equal(result.signals.symlinkedSkillCount, 1);

  const output = [];
  await run(["skills", repository, "--home", home], { log: (value) => output.push(value) });
  process.exitCode = 0;
  assert.match(output[0], /symlinked candidates: 1/);
});

test("deduplicates canonical aliases and stops symlink directory cycles", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-skills-alias-"));
  const repository = path.join(temporary, "repo");
  const source = path.join(repository, "source");
  const firstLink = path.join(repository, ".agents", "skills", "first");
  const secondLink = path.join(repository, ".agents", "skills", "second");
  const loop = path.join(repository, ".agents", "skills", "loop");
  await writeFiles(repository, {
    ".git/HEAD": "ref: refs/heads/main\n",
    "source/SKILL.md": "---\nname: aliased\ndescription: Aliased helper.\n---\n",
  });
  await fs.mkdir(path.dirname(firstLink), { recursive: true });
  try {
    const type = process.platform === "win32" ? "junction" : "dir";
    await fs.symlink(source, firstLink, type);
    await fs.symlink(source, secondLink, type);
    await fs.mkdir(loop);
    await fs.symlink(loop, path.join(loop, "back"), type);
  } catch (error) {
    context.skip(`symlinks unavailable on this host: ${error.code ?? error.message}`);
    await fs.rm(temporary, { recursive: true, force: true });
    return;
  }
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const result = await auditCodexSkills(repository, path.join(temporary, "home"));
  assert.deepEqual(result.skills.map((skill) => skill.path), [
    ".agents/skills/first/SKILL.md",
  ]);
  assert.ok(result.scanErrors.some((error) => error.code === "scan-cycle"));
});

test("recursively discovers visible skills only through Codex's bounded depth", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-skills-depth-"));
  const repository = path.join(temporary, "repo");
  await writeFiles(repository, {
    ".git/HEAD": "ref: refs/heads/main\n",
    ".agents/skills/group/visible/SKILL.md": "---\nname: visible\ndescription: Visible nested skill.\n---\n",
    ".agents/skills/.hidden/secret/SKILL.md": "---\nname: hidden\ndescription: Hidden skill.\n---\n",
    ".agents/skills/a/b/c/d/e/SKILL.md": "---\nname: depth-six\ndescription: At the boundary.\n---\n",
    ".agents/skills/a/b/c/d/e/f/SKILL.md": "---\nname: too-deep\ndescription: Beyond the boundary.\n---\n",
  });
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const result = await auditCodexSkills(repository, path.join(temporary, "home"));
  assert.deepEqual(result.skills.map((skill) => skill.name), ["depth-six", "visible"]);
  assert.equal(result.scanErrors.length, 0);
});

test("reports an existing non-directory scope in JSON and text", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-skills-scope-error-"));
  const repository = path.join(temporary, "repo");
  const home = path.join(temporary, "home");
  await writeFiles(repository, { ".git/HEAD": "ref: refs/heads/main\n" });
  await fs.mkdir(path.join(home, ".agents"), { recursive: true });
  await fs.writeFile(path.join(home, ".agents", "skills"), "not a skill directory\n");
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const result = await auditCodexSkills(repository, home);
  assert.equal(result.scopes[0].exists, true);
  assert.equal(result.scopes[0].isDirectory, false);
  assert.equal(result.scanErrors[0].path, "~/.agents/skills");
  assert.equal(result.scanErrors[0].line, 1);
  assert.match(result.scanErrors[0].message, /not a directory/);
  assert.equal(result.signals.scanErrorCount, 1);

  const output = [];
  await run(["skills", repository, "--home", home], { log: (value) => output.push(value) });
  process.exitCode = 0;
  assert.match(output[0], /scan errors/);
  assert.match(output[0], /skill scope exists but is not a directory/);
});

test("audits canonical and deprecated Codex user skill roots", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-skills-user-roots-"));
  const repository = path.join(temporary, "repo");
  const home = path.join(temporary, "home");
  await writeFiles(repository, { ".git/HEAD": "ref: refs/heads/main\n" });
  await writeFiles(home, {
    ".agents/skills/shared/SKILL.md": "---\nname: shared\ndescription: Canonical user skill.\n---\n",
    ".agents/skills/dual/SKILL.md": "---\nname: dual\ndescription: Canonical duplicate.\n---\n",
    ".codex/skills/legacy/SKILL.md": "---\nname: legacy\ndescription: Deprecated user skill.\n---\n",
    ".codex/skills/dual/SKILL.md": "---\nname: dual\ndescription: Deprecated duplicate.\n---\n",
    ".codex/skills/.system/bundled/SKILL.md": "---\nname: bundled\ndescription: System skill.\n---\n",
  });
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const result = await auditCodexSkills(repository, home);
  assert.deepEqual(result.scopes.slice(0, 2).map((scope) => ({ path: scope.path, variant: scope.variant })), [
    { path: "~/.agents/skills", variant: "shared" },
    { path: "~/.codex/skills", variant: "legacy" },
  ]);
  assert.deepEqual(result.skills.map((skill) => skill.path), [
    "~/.agents/skills/dual/SKILL.md",
    "~/.agents/skills/shared/SKILL.md",
    "~/.codex/skills/dual/SKILL.md",
    "~/.codex/skills/legacy/SKILL.md",
  ]);
  assert.equal(result.skills.some((skill) => skill.name === "bundled"), false);
  assert.equal(result.duplicates[0].name, "dual");
  assert.equal(result.duplicates[0].crossScope, true);
  assert.equal(result.signals.legacyOnlyUserSkillCount, 1);
  assert.equal(result.skills.find((skill) => skill.name === "legacy").legacyOnlyUserRoot, true);
  assert.equal(result.skills.find((skill) => skill.name === "dual" && skill.scopeVariant === "legacy").legacyOnlyUserRoot, false);
  assert.deepEqual(result.duplicates[0].occurrences.map((item) => item.scopePath), [
    "~/.agents/skills",
    "~/.codex/skills",
  ]);
  assert.match(result.provenance.implementationSource, /75cb7c903d474b6637a6e9fe6f76cedf76ef1472/);

  const output = [];
  assert.equal(await run(["skills", repository, "--home", home, "--all"], { log: (value) => output.push(value) }), 0);
  assert.match(output.join("\n"), /legacy user scope · ~\/\.codex\/skills/);
  assert.match(output.join("\n"), /legacy-only user candidates: 1/);
  assert.equal(output.join("\n").includes(temporary), false);
});
