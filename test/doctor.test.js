import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run } from "../src/cli.js";
import { parseCodexProjectConfig } from "../src/codex-config.js";
import { diagnoseCodex } from "../src/doctor.js";

async function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
  }
}

test("parses the supported Codex project-instruction settings", () => {
  const parsed = parseCodexProjectConfig(`project_doc_max_bytes = 0
project_doc_fallback_filenames = ["TEAM.md", "", "TEAM.md", "AGENTS.md"]
project_root_markers = [".project", '.git']
`);

  assert.equal(parsed.status, "parsed");
  assert.deepEqual(parsed.settings, {
    maxBytes: 0,
    fallbackFilenames: ["TEAM.md"],
    rootMarkers: [".project", ".git"],
  });
  assert.deepEqual(parsed.sources, {
    maxBytes: "user",
    fallbackFilenames: "user",
    rootMarkers: "user",
  });
  assert.deepEqual(parsed.issues, []);
});

test("fails closed on unsupported relevant Codex project settings", () => {
  const cases = [
    "\uFEFFproject_doc_max_bytes = 10\n",
    "project_doc_max_bytes = -1\n",
    "project_doc_fallback_filenames = [\n  \"TEAM.md\",\n]\n",
    "project_root_markers = [\"..\"]\n",
    "[skills]\nproject_doc_max_bytes = 10\n",
    "project_doc_max_bytes = 10\nproject_doc_max_bytes = 20\n",
  ];
  for (const content of cases) {
    const parsed = parseCodexProjectConfig(content);
    assert.equal(parsed.status, "unsupported");
    assert.equal(parsed.settings.maxBytes, null);
  }
});

test("doctor composes user instructions, configured project discovery, and skill state without path leakage", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-doctor-"));
  const repository = path.join(temporary, "repo");
  const cwd = path.join(repository, "packages", "api");
  const home = path.join(temporary, "home");
  await writeFiles(repository, {
    ".project-root": "root\n",
    "AGENTS.md": "# Root\n",
    "packages/AGENTS.override.md": "# Packages\n",
    ".agents/skills/active/SKILL.md": "---\nname: active\ndescription: Active helper.\n---\n",
    "packages/.agents/skills/off/SKILL.md": "---\nname: off\ndescription: Disabled helper.\n---\n",
  });
  await fs.mkdir(cwd, { recursive: true });
  await writeFiles(home, {
    ".codex/AGENTS.md": "# User\n",
    ".codex/config.toml": `project_doc_max_bytes = 32
project_doc_fallback_filenames = ["TEAM.md"]
project_root_markers = [".project-root"]

[[skills.config]]
name = "off"
enabled = false
`,
  });
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const report = await diagnoseCodex(cwd, home);
  assert.equal(report.profile, "codex-doctor");
  assert.deepEqual(report.repository, {
    root: "<repository>",
    currentDirectory: "packages/api",
    markerFound: true,
    marker: ".project-root",
    markers: [".project-root"],
    markerSource: "user",
  });
  assert.equal(report.instructions.user.selected.path, "~/.codex/AGENTS.md");
  assert.deepEqual(report.instructions.project.files.map((file) => file.path), [
    "AGENTS.md",
    "packages/AGENTS.override.md",
  ]);
  assert.equal(report.skills.candidateCount, 2);
  assert.equal(report.skills.disabledByUserConfigCount, 1);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(temporary), false);
  assert.equal(serialized.includes(repository), false);
  assert.equal(serialized.includes(home), false);
});

test("doctor CLI is deterministic, focused, and rejects policy options", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-doctor-cli-"));
  const repository = path.join(temporary, "repo");
  const home = path.join(temporary, "home");
  await writeFiles(repository, { ".git/HEAD": "ref: refs/heads/main\n", "AGENTS.md": "# Root\n" });
  await fs.mkdir(home, { recursive: true });
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const first = [];
  const second = [];
  const human = [];
  const help = [];
  assert.equal(await run(["doctor", repository, "--home", home, "--json"], { log: (value) => first.push(value) }), 0);
  assert.equal(await run(["doctor", repository, "--home", home, "--json"], { log: (value) => second.push(value) }), 0);
  assert.equal(await run(["doctor", repository, "--home", home], { log: (value) => human.push(value) }), 0);
  await run(["--help"], { log: (value) => help.push(value) });
  process.exitCode = 0;

  assert.equal(first[0], second[0]);
  assert.match(help[0], /instructree doctor \[cwd\] \[--home <home>\] \[--json\]/);
  assert.match(human[0], /Codex pre-session setup audit/);
  assert.match(human[0], /project instructions/);
  assert.match(human[0], /skills/);
  assert.doesNotMatch(human[0], new RegExp(temporary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await assert.rejects(() => run(["doctor", repository, "--strict"]), /audit signals are report data/);
  await assert.rejects(() => run(["doctor", repository, "--all"]), /--all can only be used with skills/);
});

test("doctor refuses to partially resolve project instructions from unsupported config", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-doctor-unsupported-"));
  const repository = path.join(temporary, "repo");
  const home = path.join(temporary, "home");
  await writeFiles(repository, { ".git/HEAD": "ref: refs/heads/main\n", "AGENTS.md": "# Root\n" });
  await writeFiles(home, {
    ".codex/config.toml": "project_doc_max_bytes = 12\nproject_root_markers = [\n  \".git\",\n]\n",
  });
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const report = await diagnoseCodex(repository, home);
  assert.equal(report.configuration.project.status, "unsupported");
  assert.equal(report.instructions.project.status, "unavailable");
  assert.deepEqual(report.instructions.project.files, []);
});
