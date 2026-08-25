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

## Try it

No install or API key:

```bash
npx --yes github:kotobuki09/instructree#v0.10.0
```

Add the same audit to every pull request without copying workflow YAML:

```bash
npx --yes github:kotobuki09/instructree#v0.10.0 init
```

Send findings to GitHub code scanning with one command:

```bash
npx --yes github:kotobuki09/instructree#v0.10.0 init --code-scanning
```

Trace the Codex project instructions for one file:

```bash
npx --yes github:kotobuki09/instructree#v0.10.0 explain src/api/client.ts --client codex
```

Install from GitHub if you want the command everywhere:

```bash
npm install --global github:kotobuki09/instructree#v0.10.0
instructree
```

Install the native skill for Codex with GitHub CLI 2.90 or later:

```bash
gh skill install kotobuki09/instructree instructree@v0.10.0 --agent codex --scope user
```

Or use the cross-agent `skills` installer: `npx skills add kotobuki09/instructree --skill instructree -g --agent codex`.

Then ask: `Use $instructree to audit the agent instructions in this repository.` See the focused [Codex setup](docs/codex-setup.md) for the companion engineering and launch skills used to develop this project.

If Instructree catches a stale or conflicting agent instruction before your next coding session, [star the repository](https://github.com/kotobuki09/instructree) so more coding-agent users can find it.

## What it catches

- malformed or incomplete frontmatter in skills, custom agents, and agentic workflows;
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

`--fallback` accepts one portable repository-local filename and can be repeated in precedence order. `--max-bytes` accepts a non-negative integer. These options correspond to Codex's `project_doc_fallback_filenames` and `project_doc_max_bytes` settings, but are explicit CLI inputs: Instructree does not read user-level Codex configuration or upload repository content. The JavaScript API uses `explain(target, root, { client: "codex", fallbackFilenames: ["PROJECT.md"], maxBytes: 65536 })`. Use plain `explain` for the neutral cross-client map; Codex configuration flags require `--client codex`, which cannot be combined with `--effective`.

Candidate existence, empty-file behavior, and byte truncation are also checked against the pinned [Codex implementation](https://github.com/openai/codex/blob/9be8d6e1c3dbb145d2d7ac3ba46729340e6d8d40/codex-rs/core/src/agents_md.rs), because those details are more precise than the user guide.

## CI

```yaml
name: instruction-lint
on: [pull_request]

jobs:
  instructree:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: kotobuki09/instructree@v0.10.0
        with:
          strict: true
```

`instructree init` creates this workflow and refuses to overwrite an existing file. The action runs directly on Node 24, needs no dependency-install step, and turns diagnostics into file-and-line annotations. Set `root` to scan one repository subdirectory.

For code scanning, run the CLI with `--sarif` and upload `instructree.sarif` with GitHub's [`upload-sarif` action](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github). SARIF keeps the normal exit policy: errors fail, and warnings fail only with `--strict`.

`instructree init --code-scanning` creates that SARIF workflow for you. It uses read-only repository contents permission, grants `security-events: write` only to the scan job, skips SARIF upload for forked pull requests, and still enforces the Instructree exit policy.

## Design boundaries

Instructree is static analysis. It does not call a model, upload repository content, or claim to predict agent behavior. Discovery and precedence differ between clients and versions, so `explain` says what *may* apply and shows each format separately. `AGENTS.override.md` is reported as Codex-specific guidance; it is not expanded as a GitHub Copilot CLI `@path` import root. Import expansion is explicitly labeled as GitHub Copilot CLI behavior; other clients' import semantics are not inferred. Conflict detection is intentionally conservative and reported as a warning for human review.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the small, dependency-free development loop. If Instructree misses a real instruction format, [open an issue](https://github.com/kotobuki09/instructree/issues/new/choose) with a minimal example.
