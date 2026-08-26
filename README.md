<div align="center">

# Instructree

**Find the instructions your AI coding agent will actually use.**

Map and lint `AGENTS.md`, Codex `AGENTS.override.md`, `CLAUDE.md`, Copilot instructions, agent skills, and agentic workflows—including recursive `@path` imports—locally, with zero runtime dependencies.

[![CI](https://github.com/kotobuki09/instructree/actions/workflows/ci.yml/badge.svg)](https://github.com/kotobuki09/instructree/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Skills.sh](https://img.shields.io/badge/Skills.sh-Instructree-111111)](https://www.skills.sh/kotobuki09/instructree/instructree)

</div>

![Instructree terminal demo](assets/demo.svg)

Coding agents now read instructions from several files with different scopes. One stale nested rule can quietly fight the repository rule. Instructree gives you the map before the agent gets the prompt.

It also debugs a subtle Codex failure mode: a nested `.git` or configured project marker can hide parent `AGENTS.md` files even though they look relevant from the outer repository.

## Try it

No install or API key:

```bash
npx --yes github:kotobuki09/instructree#v0.20.0
```

Add the same audit to every pull request without copying workflow YAML:

```bash
npx --yes github:kotobuki09/instructree#v0.20.0 init
```

Send findings to GitHub code scanning with one command:

```bash
npx --yes github:kotobuki09/instructree#v0.20.0 init --code-scanning
```

Diagnose Codex instructions, supported user config, and skill state in one share-safe report:

```bash
instructree doctor
```

Audit a focused Codex engineering stack against the skills already on disk:

```bash
instructree starter
```

The starter audit is read-only. It classifies six source-grounded companions as ready, disabled, invalid, or missing and prints install commands only for missing skills. Review every linked `SKILL.md` before installation because skills influence agent decisions.

If Codex appears to ignore a parent file, follow the source-grounded [Codex AGENTS.md debugging guide](https://kotobuki09.github.io/instructree/codex-agents-md-debugger.html) for project-root markers, overrides, byte budgets, user instructions, and disabled skills.

If a large skill catalog is losing useful descriptions, use the [Codex skill-overload guide](https://kotobuki09.github.io/instructree/codex-skill-overload.html) to find the largest enabled contributors, review duplicates, and return to a focused stack without automatic deletion.

Trace the Codex project instructions for one file:

```bash
npx --yes github:kotobuki09/instructree#v0.20.0 explain src/api/client.ts --client codex
```

Audit Codex user and repository-local skill candidate scopes plus supported user config state (the report is read-only and redacts absolute paths):

```bash
instructree skills . --client codex
```

The default report keeps scope counts and every actionable finding concise. It audits the shared `~/.agents/skills` user root plus Codex's deprecated `~/.codex/skills` compatibility root, keeping their provenance distinct so installer mismatches and cross-root duplicates are visible. It records whether a candidate was reached through a symlink without revealing its target path. It reads supported skill settings from user `~/.codex/config.toml` to explain disabled candidates, later-rule precedence, unmatched selectors, catalog injection, bundled skills, and the configured context cap. It also ranks up to five enabled candidates by approximate fallback-character cost, using current Codex's 1,024-character per-description cap. Add `--all` for the complete human-readable inventory or `--json` for the full structured result. The [pinned root-compatibility note](docs/research/codex-user-skill-roots.md) documents the source and the custom `CODEX_HOME` limitation.

**Codex Desktop cannot see a repository skill?** Follow the source-grounded [Desktop local-skill troubleshooting guide](docs/codex-desktop-local-skills.html) to verify on-disk candidates and supported configuration without copying project skills into a global user scope. The audit cannot prove a running Desktop session loaded a skill; keep native runtime evidence separate.

Install from GitHub if you want the command everywhere:

```bash
npm install --global github:kotobuki09/instructree#v0.20.0
instructree
```

Install the native skill for Codex with GitHub CLI 2.90 or later:

```bash
gh skill install kotobuki09/instructree instructree@v0.20.0 --agent codex --scope user
```

Or use the cross-agent `skills` installer: `npx skills add kotobuki09/instructree --skill instructree -g --agent codex`.

Then ask: `Use $instructree to audit the agent instructions in this repository.` See the focused [Codex setup](docs/codex-setup.md) for the companion engineering and launch skills used to develop this project.

If Instructree catches a stale or conflicting agent instruction before your next coding session, [star the repository](https://github.com/kotobuki09/instructree) so more coding-agent users can find it.

## What it catches

- malformed or incomplete frontmatter in skills, custom agents, and agentic workflows;
- UTF-8 BOM-prefixed `SKILL.md` frontmatter that [current Codex versions may misreport as missing](docs/research/codex-skill-utf8-bom.md);
- disabled candidates, unmatched selectors, and unsupported relevant syntax in user `~/.codex/config.toml` skill settings;
- user skills split between the shared `~/.agents/skills` root and Codex's deprecated default `~/.codex/skills` compatibility root;
- the largest enabled contributors to Codex's bounded model-visible skill catalog, with the estimate boundary stated explicitly;
- Codex project-root markers, fallback filenames, byte budgets, user instructions, and project instruction chains in one redacted pre-session report;
- ignored parent instructions hidden by a nearer Codex project-root marker, with redacted ancestor labels and the outer marker that explains the boundary;
- duplicate skill names across `.agents`, `.claude`, and `.github`;
- skill names that do not use portable kebab-case or match their folder, with nested namespace prefixes supported;
- broken relative Markdown links inside agent instruction files;
- instruction files that are manual-only because they have no path glob;
- Codex-specific `AGENTS.override.md` files at repository or nested directory scope;
- recursive Copilot `@path` imports that are missing, cyclic, duplicated, absolute, or escape the repository;
- likely `always`/`never` conflicts in overlapping scopes, clearly labeled as heuristic.

It prints stable file-and-line diagnostics and exits nonzero for schema errors, so the default is safe for CI. Add `--strict` to fail on warnings too.

Use `--sarif` to send the same diagnostics to GitHub code scanning or another SARIF 2.1.0 consumer. The report includes stable rule IDs, repository-relative file URIs, line locations, and error, warning, or note severity.

The [real-world compatibility report](docs/compatibility.md) pins and audits 682 instruction and skill files across three public catalogs. The v0.5.0 pass reduced one large catalog from 255 noisy findings to four reviewable diagnostics with zero errors.

## Supported formats

| Surface | Files discovered | Path explanation |
| --- | --- | --- |
| Cross-agent | `AGENTS.md` at any depth | Directory scope |
| OpenAI Codex | `AGENTS.override.md` at any depth | Directory scope |
| Claude | `CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/*.md` | Directory scope or `paths` |
| GitHub Copilot | `.github/copilot-instructions.md`, `*.instructions.md`, recursive `@path` imports | Repository scope, `applyTo`, and effective import graph |
| Agent Skills | catalog-root `*/SKILL.md`; nested `skills/**/SKILL.md`, `.agents/skills/**/SKILL.md`, `.claude/skills/**/SKILL.md`, `.github/skills/**/SKILL.md` | Listed as on demand |
| Custom agents | `.github/agents/*.agent.md` | Listed as on demand |
| Agentic Workflows | `.github/workflows/*.md` | Metadata validation |
| Other agents | `GEMINI.md`, `.cursor/rules/*.mdc`, `.windsurf/rules/*.md` | Directory scope or `globs` |

### Trace the effective import graph

[GitHub Copilot CLI expands relative `@path` lines](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions) in `.github/copilot-instructions.md`, `AGENTS.md`, and `CLAUDE.md`. Instructree follows those references recursively without executing anything:

```bash
instructree imports
```

```text
AGENTS.md
├─ docs/base-rules.md :4
│  └─ docs/testing.md :8
└─ docs/security.md :5

clean · 1 roots · 3 imported files · 0 errors
```

The audit rejects absolute paths, repository escapes, symlink escapes, missing targets, cycles, oversized files, and graphs beyond its explicit safety limits. `GEMINI.md` and `*.instructions.md` references are not expanded because Copilot's documentation says it does not expand them.

The formats are grounded in the current [OpenAI Codex AGENTS.md guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [VS Code custom-instructions documentation](https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/custom-instructions.md), [GitHub customization matrix](https://docs.github.com/en/copilot/reference/customization-cheat-sheet), and [Agent Skills documentation](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills).

## Commands

```text
instructree [scan] [root] [--json | --sarif] [--strict]
instructree imports [root] [--json] [--strict]
instructree skills [cwd] [--home <home>] [--client codex] [--all | --json]
instructree starter [cwd] [--home <home>] [--json]
instructree doctor [cwd] [--home <home>] [--json]
instructree explain <file> [--root <root>] [--client codex [--fallback <name>]... [--max-bytes <n>] | --effective] [--json]
instructree init [root] [--code-scanning]
instructree --help | --version
```

Examples:

```bash
# Scan this repository
instructree

# Scan a different checkout and fail on warnings
instructree ../my-monorepo --strict

# Feed diagnostics to another tool
instructree --json > instructree-report.json

# Produce a SARIF 2.1.0 report for code scanning
instructree --sarif > instructree.sarif

# See the broad-to-specific instruction map for a target
instructree explain packages/api/src/routes.ts --effective

# Select the Codex project instruction chain for a target
instructree explain packages/api/src/routes.ts --client codex --json

# Audit Codex skill candidates and supported user config without installing anything
instructree skills . --client codex --json

# Check a focused companion stack and print commands only for missing skills
instructree starter . --json

# Produce one share-safe Codex setup report before starting a session
instructree doctor . --json

# Mirror project_doc_fallback_filenames and project_doc_max_bytes from Codex config
instructree explain packages/api/src/routes.ts --client codex \
  --fallback PROJECT.md --fallback TEAM.md --max-bytes 65536 --json

# Audit the transitive Copilot import graph
instructree imports --json

# Create .github/workflows/instructree.yml without overwriting an existing file
instructree init

# Create .github/workflows/code-scanning.yml without overwriting an existing file
instructree init --code-scanning
```

Exit codes are `0` for a passing policy, `1` for diagnostics that fail the selected policy, and `2` for invalid arguments or runtime errors.

`explain <file> --client codex` follows the documented Codex project precedence from the repository root through the target file's directory. In each directory it selects the first existing regular file from `AGENTS.override.md`, `AGENTS.md`, then the ordered `--fallback` filenames, and reports at most one selection per directory in broad-to-specific order. An existing empty candidate is reported as empty and blocks later candidates in that directory, matching Codex. The combined chain defaults to a 32,768-byte `--max-bytes` budget; per-file `bytes`, `includedBytes`, `empty`, `includedEmpty`, and `truncated` fields plus the top-level `codex` metadata make truncation and exclusion explicit in JSON.

`--fallback` accepts one portable repository-local filename and can be repeated in precedence order. `--max-bytes` accepts a non-negative integer. These options correspond to Codex's `project_doc_fallback_filenames` and `project_doc_max_bytes` settings, but are explicit CLI inputs: the `explain` command does not read those user-level settings or upload repository content. The JavaScript API uses `explain(target, root, { client: "codex", fallbackFilenames: ["PROJECT.md"], maxBytes: 65536 })`. Use plain `explain` for the neutral cross-client map; Codex configuration flags require `--client codex`, which cannot be combined with `--effective`.

Candidate existence, empty-file behavior, and byte truncation are also checked against the pinned [Codex implementation](https://github.com/openai/codex/blob/9be8d6e1c3dbb145d2d7ac3ba46729340e6d8d40/codex-rs/core/src/agents_md.rs), because those details are more precise than the user guide.

`skills [cwd] [--client codex]` inventories the user `~/.agents/skills` scope and each `.agents/skills` directory from the current directory to the repository root. It recursively scans the depth-bounded local roots, follows symlinked skill folders, deduplicates canonical targets, skips hidden descendants, and keeps output paths logical and repository-relative. It reports possible duplicate names with source lines, malformed `SKILL.md` metadata, scan failures, and an approximate initial-list character estimate that includes name, description, and logical path. It also reads the supported skill subset of user `~/.codex/config.toml`, applying current Codex name/path selector and later-rule precedence to report disabled candidates, unmatched rules, catalog injection, bundled-skill state, and `max_context_tokens`. Unsupported relevant syntax fails closed: no user rules are applied and the affected lines are reported. The estimate is compared only with the documented 8,000-character reference used when the context window is unknown; Codex otherwise defaults to 2% of the known model context, and explicit configuration can differ. `--home <home>` is an optional override for testing or inspecting another user scope. This read-only audit excludes admin/system and plugin skills, session flags, project config (which current Codex main does not apply to skill rules), product restrictions, and configured project-root markers, so it does not claim the exact loaded list. Instructree does not install skills, upload files, or write to either scope. The config behavior is documented in the pinned [Codex skill-config research note](docs/research/codex-skill-config.md); discovery remains grounded in official [Codex skills documentation](https://developers.openai.com/codex/skills) and pinned Codex [discovery](https://github.com/openai/codex/blob/399be2d6b509900dc17b45ca6752b0a4ee882ab1/codex-rs/ext/skills/src/loader/discovery.rs) and [merge](https://github.com/openai/codex/blob/399be2d6b509900dc17b45ca6752b0a4ee882ab1/codex-rs/ext/skills/src/loader/host_merge.rs) implementations.

`starter [cwd]` reuses that local inventory to check a focused six-skill engineering stack covering discovery, testing, diagnosis, review, research, and verification. It reports ready, disabled, invalid, and missing states using logical paths, includes the current catalog-pressure context, and prints installation commands only for missing companions. It does not call the skills directory, download packages, edit configuration, or install anything. The selection is a dated, source-linked recommendation rather than a claim that popularity proves quality or task fit; review each linked `SKILL.md` before installation.

`doctor [cwd]` combines the focused Codex project-instruction and skill audits into one deterministic pre-session report. It reads supported top-level `project_doc_max_bytes`, `project_doc_fallback_filenames`, and `project_root_markers` values from user `~/.codex/config.toml`; identifies the selected non-empty user `AGENTS.override.md` or `AGENTS.md`; resolves the project chain for the current directory; and summarizes disabled skills, duplicates, metadata failures, scan errors, and context pressure. When a nearer project marker stops discovery inside an outer project, it reports the ignored parent instructions using redacted `<parent>` labels and identifies the outer marker without exposing an absolute path. JSON and human output use logical paths and never include the absolute home or repository path. Unsupported relevant project-setting syntax fails closed, so the project chain is reported as unavailable instead of applying partial settings. This is a static user-configured preview, not a claim about a running or resumed session: managed config, profiles, session flags, project trust, remote environments, plugins, and product restrictions remain outside its boundary. See the pinned [Codex doctor research note](docs/research/codex-doctor.md) and [root-boundary research note](docs/research/codex-root-boundary.md).

## CI

```yaml
name: instruction-lint
on: [pull_request]

jobs:
  instructree:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: kotobuki09/instructree@v0.20.0
        with:
          strict: true
```

`instructree init` creates this workflow and refuses to overwrite an existing file. The action runs directly on Node 24, needs no dependency-install step, and turns diagnostics into file-and-line annotations. Set `root` to scan one repository subdirectory.

For code scanning, run the CLI with `--sarif` and upload `instructree.sarif` with GitHub's [`upload-sarif` action](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github). SARIF keeps the normal exit policy: errors fail, and warnings fail only with `--strict`.

`instructree init --code-scanning` creates that SARIF workflow for you. It uses read-only repository contents permission, grants `security-events: write` only to the scan job, skips SARIF upload for forked pull requests, and still enforces the Instructree exit policy.

## Design boundaries

Instructree is static analysis. It does not call a model, upload repository content, or claim to predict agent behavior. Discovery and precedence differ between clients and versions, so `explain` says what *may* apply and shows each format separately. `AGENTS.override.md` is reported as Codex-specific guidance; it is not expanded as a GitHub Copilot CLI `@path` import root. Import expansion is explicitly labeled as GitHub Copilot CLI behavior; other clients' import semantics are not inferred. Conflict detection is intentionally conservative and reported as a warning for human review.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the small, dependency-free development loop. If Instructree misses a real instruction format, [open an issue](https://github.com/kotobuki09/instructree/issues/new/choose) with a minimal example.
