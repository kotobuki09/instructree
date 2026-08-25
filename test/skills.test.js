import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditCodexSkills } from "../src/index.js";
import { run } from "../src/cli.js";

async function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
  }
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
  const estimatedDescriptions = result.skills.reduce((total, skill) => total + Array.from(skill.description ?? "").length, 0);
  const estimatedPaths = result.skills.reduce((total, skill) => total + Array.from(skill.path).length, 0);
  assert.equal(result.pressure.estimatedNameChars, estimatedNames);
  assert.equal(result.pressure.estimatedDescriptionChars, estimatedDescriptions);
  assert.equal(result.pressure.estimatedPathChars, estimatedPaths);
  assert.equal(result.pressure.estimatedInitialListChars, estimatedNames + estimatedDescriptions + estimatedPaths + result.skills.length * 3);
  assert.match(result.pressure.note, /2%/);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(home), false);
  assert.equal(serialized.includes(repository), false);
});

test("labels an overlong approximate initial list against the unknown-window reference", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-skills-pressure-"));
  const repository = path.join(temporary, "repo");
  await writeFiles(repository, {
    ".git/HEAD": "ref: refs/heads/main\n",
    ".agents/skills/large/SKILL.md": `---\nname: large\ndescription: ${"x".repeat(8000)}\n---\n`,
  });
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const result = await auditCodexSkills(repository, path.join(temporary, "home"));
  assert.equal(result.pressure.status, "exceeds-unknown-window-reference");
  assert.ok(result.pressure.estimatedInitialListChars > result.pressure.unknownContextWindowReferenceChars);
});

test("skills CLI emits deterministic JSON and exposes the audit in help", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-skills-cli-"));
  const repository = path.join(temporary, "repo");
  const home = path.join(temporary, "home");
  const cwd = path.join(repository, "nested");
  await writeFiles(repository, {
    ".git/HEAD": "ref: refs/heads/main\n",
    ".agents/skills/repo-skill/SKILL.md": "---\nname: repo-skill\ndescription: Repository helper.\n---\n",
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
  const exitCode = await run(["skills", cwd, "--home", home, "--client", "codex", "--json"], { log: (value) => first.push(value) });
  await run(["skills", cwd, "--home", home, "--client", "codex", "--json"], { log: (value) => second.push(value) });
  await run(["skills", cwd, "--home", home, "--json"], { log: (value) => implicit.push(value) });
  await run(["skills", cwd, "--home", home], { log: (value) => human.push(value) });
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
  assert.match(help[0], /instructree skills \[cwd\] \[--home <home>\] \[--client codex\]/);
  assert.equal(JSON.parse(omittedCwd[0]).repository.currentDirectory, "nested");
  assert.ok(JSON.parse(first[0]).skills.some((skill) => skill.name === "repo-skill"));
  assert.equal(JSON.parse(first[0]).duplicates[0].occurrences[0].line, 2);
  assert.match(human[0], /possible duplicate skill names/);
  assert.match(human[0], /repo-skill\/SKILL\.md:2/);
  assert.match(human[0], /metadata warnings/);
  await assert.rejects(() => run(["skills", cwd, "--client", "claude"]), /unknown client: claude/);
  await assert.rejects(() => run(["skills", cwd, "--strict"]), /audit signals are report data/);
  assert.deepEqual(JSON.parse(first[0]).provenance.limitations, [
    "Does not include Codex admin or system skills.",
    "Does not read ~/.codex/config.toml, so local skill enable or disable state is unknown.",
    "Uses the nearest .git marker rather than configured Codex project-root markers.",
    "Reports candidate discovery paths, not the exact skills loaded for a run.",
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
  assert.match(result.scanErrors[0].message, /not a directory/);
  assert.equal(result.signals.scanErrorCount, 1);

  const output = [];
  await run(["skills", repository, "--home", home], { log: (value) => output.push(value) });
  process.exitCode = 0;
  assert.match(output[0], /scan errors/);
  assert.match(output[0], /skill scope exists but is not a directory/);
});
