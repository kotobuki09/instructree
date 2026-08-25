import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditCodexStarter } from "../src/index.js";
import { run } from "../src/cli.js";

async function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
  }
}

async function fixture(context) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "instructree-starter-test-"));
  const repository = path.join(temporary, "repo");
  const home = path.join(temporary, "home");
  await writeFiles(repository, { ".git/HEAD": "ref: refs/heads/main\n" });
  await writeFiles(home, {
    ".agents/skills/find-skills/SKILL.md": "---\nname: find-skills\ndescription: Discover capabilities.\n---\n",
    ".agents/skills/tdd/SKILL.md": "---\nname: tdd\ndescription: Test-driven development.\n---\n",
    ".agents/skills/code-review/SKILL.md": "---\nname: code-review\n---\n",
    ".codex/config.toml": "[[skills.config]]\nname = \"tdd\"\nenabled = false\n",
  });
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));
  return { temporary, repository, home };
}

test("starter audit classifies a focused source-grounded Codex stack", async (context) => {
  const { temporary, repository, home } = await fixture(context);
  const result = await auditCodexStarter(repository, home);

  assert.equal(result.client, "codex");
  assert.equal(result.profile, "codex-starter-stack");
  assert.equal(result.readOnly, true);
  assert.deepEqual(result.companions.map((item) => item.name), [
    "find-skills",
    "tdd",
    "diagnosing-bugs",
    "code-review",
    "research",
    "verification-before-completion",
  ]);
  assert.deepEqual(result.summary, { total: 6, ready: 1, disabled: 1, invalid: 1, missing: 3 });
  assert.deepEqual(
    Object.fromEntries(result.companions.map((item) => [item.name, item.status])),
    {
      "find-skills": "ready",
      tdd: "disabled",
      "diagnosing-bugs": "missing",
      "code-review": "invalid",
      research: "missing",
      "verification-before-completion": "missing",
    },
  );
  assert.ok(result.companions.every((item) => item.skillUrl.startsWith("https://www.skills.sh/")));
  assert.ok(result.companions.every((item) => item.installCommand.includes(`--skill ${item.name}`)));
  assert.equal(JSON.stringify(result).includes(temporary), false);
});

test("starter CLI prints commands only for missing companions and changes no files", async (context) => {
  const { temporary, repository, home } = await fixture(context);
  const before = await fs.readdir(path.join(home, ".agents", "skills"));
  const output = [];

  assert.equal(await run(["starter", repository, "--home", home], { log: (value) => output.push(value) }), 0);
  const rendered = output.join("\n");
  assert.match(rendered, /read-only/i);
  assert.match(rendered, /no files changed/i);
  assert.match(rendered, /review.*SKILL\.md/i);
  assert.match(rendered, /--skill diagnosing-bugs/);
  assert.match(rendered, /--skill research/);
  assert.match(rendered, /--skill verification-before-completion/);
  assert.doesNotMatch(rendered, /--skill find-skills/);
  assert.doesNotMatch(rendered, /--skill tdd/);
  assert.doesNotMatch(rendered, /--skill code-review/);
  assert.equal(rendered.includes(temporary), false);
  assert.deepEqual(await fs.readdir(path.join(home, ".agents", "skills")), before);
});

test("starter CLI emits deterministic JSON and rejects unrelated options", async (context) => {
  const { repository, home } = await fixture(context);
  const first = [];
  const second = [];

  assert.equal(await run(["starter", repository, "--home", home, "--json"], { log: (value) => first.push(value) }), 0);
  assert.equal(await run(["starter", repository, "--home", home, "--json"], { log: (value) => second.push(value) }), 0);
  assert.deepEqual(first, second);
  assert.equal(JSON.parse(first[0]).profile, "codex-starter-stack");

  await assert.rejects(() => run(["starter", repository, "--all"], { log() {} }), /--all can only be used with skills/);
  await assert.rejects(() => run(["starter", repository, "--strict"], { log() {} }), /starter does not accept --strict/);
  await assert.rejects(() => run(["starter", repository, "--client", "codex"], { log() {} }), /--client can only be used with explain or skills/);
});
