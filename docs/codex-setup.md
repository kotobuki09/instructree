# Codex setup

Instructree ships as both a CLI and an agent skill. With GitHub CLI 2.90 or later, install the versioned skill at user scope for Codex:

```bash
gh skill install kotobuki09/instructree instructree@v0.18.0 --agent codex --scope user
```

Alternatively, use the cross-agent installer:

```bash
npx skills add kotobuki09/instructree --skill instructree -g --agent codex
```

The skill tells Codex when to scan the repository, trace recursive imports, or explain the instruction scope for one file. For a Codex target, `instructree explain <file> --client codex` reports the repository project-instruction chain using Codex override precedence. Add repeatable `--fallback <filename>` values and `--max-bytes <non-negative-integer>` to mirror `project_doc_fallback_filenames` and `project_doc_max_bytes` explicitly. It asks before downloading the CLI when no local command is available.

To add the same secure SARIF checks to a repository, run:

```bash
npx --yes github:kotobuki09/instructree#v0.18.0 init --code-scanning
```

The generated workflow uses least-privilege permissions, avoids privileged SARIF uploads from forked pull requests, and refuses to overwrite an existing workflow.

## Audit the focused starter stack

Turn the recommendations below into a local readiness report:

```bash
instructree starter .
```

The command reuses Instructree's Codex skill inventory and classifies each companion as ready, disabled by supported user config, invalid on disk, or missing. It includes catalog-pressure context and prints installation commands only for missing companions. It is read-only: it does not call the directory, download packages, edit config, or install skills. Review each linked `SKILL.md` before installation because skills influence agent decisions. Add `--json` for deterministic output or `--home <home>` to inspect another user scope.

## Diagnose the whole Codex setup

Before starting a session, run one share-safe report from the working directory:

```bash
instructree doctor .
```

The doctor reads supported user `project_doc_max_bytes`, `project_doc_fallback_filenames`, and `project_root_markers`; identifies the selected non-empty user `AGENTS.override.md` or `AGENTS.md`; resolves the current directory's project chain; and summarizes local skill candidates and supported user skill configuration. Add `--json` for deterministic machine-readable output. Both formats redact absolute home and repository paths.

This is a static pre-session preview. It deliberately does not claim to resolve managed configuration, profiles, session overrides, project trust, remote environments, plugins, or a resumed session. Unsupported relevant project-setting syntax fails closed instead of producing a partial chain. The boundary and pinned sources are recorded in the [Codex doctor research note](research/codex-doctor.md).

### Debug a nested project-root boundary

Codex stops at the nearest configured project-root marker. In a submodule, worktree, or directory containing an accidental nested `.git` entry, that can hide plausible parent `AGENTS.md` files. The doctor inspects only as far as the nearest outer marker and reports the hidden candidates with redacted labels:

```text
root boundary: 1 parent instruction ignored above selected project root
- <parent>/AGENTS.md · ignored above selected project root
- outer marker: .git at <parent>
```

The files remain outside the effective project chain; Instructree does not read their contents or claim that Codex loaded them. The behavior and current Codex sources are documented in the [root-boundary research note](research/codex-root-boundary.md).

Instructree recognizes Codex-specific `AGENTS.override.md` files described in the official [OpenAI Codex AGENTS.md guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md). They are shown with normal directory scope in `scan` and neutral `explain`, while `explain --client codex` resolves the first existing regular candidate per directory, even when that candidate is empty. Its JSON output reports the configured fallbacks, shared byte budget, included bytes, and truncation state. The empty-candidate and byte-budget details are checked against the pinned [Codex implementation](https://github.com/openai/codex/blob/9be8d6e1c3dbb145d2d7ac3ba46729340e6d8d40/codex-rs/core/src/agents_md.rs). Codex overrides remain outside GitHub Copilot CLI `@path` import expansion.

## Audit local skill candidate scopes

Before adding or troubleshooting skills, inspect the user and repository candidate directories from a checkout:

```bash
instructree skills . --client codex
```

The concise default includes scope counts and every actionable finding. Add `--all` for the complete human-readable candidate inventory or `--json` for the full structured object.

The report includes the user `~/.agents/skills` catalog and every repository-local `.agents/skills` candidate scope from the current directory to the repository root. It recursively scans each depth-bounded root, follows symlinked skill folders, deduplicates canonical targets, skips hidden descendants, and keeps paths logical instead of exposing absolute home directories. It highlights possible duplicate names with source lines, missing or malformed `name`/`description` metadata, scan failures, and an approximate initial-list character estimate. It reads supported user `~/.codex/config.toml` skill settings to show disabled candidates, unmatched name/path rules, later-rule precedence, catalog injection, bundled-skill state, and the configured context cap. Unsupported relevant syntax is reported and no user rules are applied. `cwd` defaults to the current directory, and `--home <home>` is an optional testing or inspection override. This command is read-only and excludes admin/system and plugin skills, session overrides, project-level skill rules, product restrictions, and configured project-root markers, so it does not claim the exact loaded list. Config behavior is grounded in the pinned [Codex skill-config research note](research/codex-skill-config.md); discovery is grounded in the official [Codex skills documentation](https://developers.openai.com/codex/skills) and pinned Codex [discovery](https://github.com/openai/codex/blob/399be2d6b509900dc17b45ca6752b0a4ee882ab1/codex-rs/ext/skills/src/loader/discovery.rs), [root resolution](https://github.com/openai/codex/blob/399be2d6b509900dc17b45ca6752b0a4ee882ab1/codex-rs/ext/skills/src/host_roots.rs), and [merge](https://github.com/openai/codex/blob/399be2d6b509900dc17b45ca6752b0a4ee882ab1/codex-rs/ext/skills/src/loader/host_merge.rs) implementations.

## Focused companion stack

This is a deliberately small stack. Popularity is a filter, not a reason to load unrelated instructions into every task.

| Need | Skill | Why it is included |
| --- | --- | --- |
| Discover a missing capability | [`vercel-labs/skills@find-skills`](https://skills.sh/vercel-labs/skills/find-skills) | Official directory discovery workflow and the top all-time skill when reviewed on 2026-08-26. |
| Develop against tests | [`mattpocock/skills@tdd`](https://skills.sh/mattpocock/skills/tdd) | High-adoption test-driven implementation loop. |
| Diagnose a difficult defect | [`mattpocock/skills@diagnosing-bugs`](https://skills.sh/mattpocock/skills/diagnosing-bugs) | High-adoption, hypothesis-driven debugging workflow. |
| Review a change | [`mattpocock/skills@code-review`](https://skills.sh/mattpocock/skills/code-review) | High-adoption, evidence-first review workflow. |
| Verify before claiming completion | [`obra/superpowers@verification-before-completion`](https://skills.sh/obra/superpowers/verification-before-completion) | Requires fresh command evidence before completion claims. |
| Research current ecosystems | [`mattpocock/skills@research`](https://skills.sh/mattpocock/skills/research) | Source-grounded research for changing tools and distribution channels. |

Install only missing skills. Review the linked `SKILL.md` before installation because skills influence agent decisions.

```bash
npx skills add vercel-labs/skills --skill find-skills -g --agent codex
npx skills add mattpocock/skills --skill tdd -g --agent codex
npx skills add mattpocock/skills --skill diagnosing-bugs -g --agent codex
npx skills add mattpocock/skills --skill code-review -g --agent codex
npx skills add obra/superpowers --skill verification-before-completion -g --agent codex
npx skills add mattpocock/skills --skill research -g --agent codex
```

The stack covers common engineering phases without trying to load a specialist skill for every possible task. Popularity is only a discovery filter; it does not establish quality, security, or fit for a particular repository.
