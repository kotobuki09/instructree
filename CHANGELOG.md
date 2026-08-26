# Changelog

All notable changes to Instructree are documented here.

## Unreleased

## 0.20.0 — 2026-08-26

- Rank the largest enabled contributors to Codex's bounded skill catalog using the current per-description cap, and add a source-grounded skill-overload guide.

## 0.19.0 — 2026-08-26

- Audit both the shared `~/.agents/skills` user root and Codex's deprecated `~/.codex/skills` compatibility root, while keeping their provenance distinct and excluding hidden system descendants.

## 0.18.0 — 2026-08-26

- Add `instructree starter [cwd]` for a read-only readiness audit of a focused, source-grounded Codex engineering stack, with install commands only for missing companions.

## 0.17.0 — 2026-08-26

- Make `instructree doctor` report redacted parent instruction files hidden by a nearer configured project-root marker, including the nearest outer marker that establishes the boundary.

## 0.16.0 — 2026-08-26

- Add `instructree doctor [cwd]` for one share-safe Codex pre-session report covering supported user project settings, user instructions, the current project chain, and summarized skill state.
- Honor supported user `project_root_markers`, `project_doc_fallback_filenames`, and `project_doc_max_bytes` while failing closed on unsupported relevant syntax and redacting absolute paths.

## 0.15.0 — 2026-08-26

- Read supported user `~/.codex/config.toml` skill settings, resolve current Codex name/path rule precedence, and report disabled candidates, unmatched rules, and config issues without exposing absolute paths.

## 0.14.0 — 2026-08-26

- Detect UTF-8 BOM-prefixed `SKILL.md` frontmatter with a precise Codex compatibility error while still parsing valid metadata behind it.

## 0.13.0 — 2026-08-26

- Keep `instructree skills` concise by default while preserving the full human-readable inventory behind `--all`; JSON remains complete and unchanged.

## 0.12.0 — 2026-08-26

- Add `instructree skills [cwd] [--client codex]` for a read-only inventory of Codex user and repository-local skill candidate scopes.
- Report duplicate names with source lines, metadata and filesystem failures, and deterministic logical paths without exposing absolute home or repository paths.
- Match Codex's depth-bounded recursive discovery, hidden-directory pruning, symlink following, and canonical target deduplication while stating admin, system, config, and project-root limitations.
- Estimate initial-list pressure from skill names, descriptions, and logical paths using the documented 8,000-character unknown-context reference and support YAML block-scalar descriptions.

## 0.11.0 — 2026-08-26

- Add repeatable `--fallback <filename>` and `--max-bytes <non-negative-integer>` options to `explain --client codex`, corresponding to Codex's `project_doc_fallback_filenames` and `project_doc_max_bytes` settings.
- Match Codex candidate selection by choosing the first existing regular file per directory, including an empty file that blocks later candidates.
- Report selected, empty, included, and truncated byte metadata for the combined root-to-target project instruction budget.
- Reject unsafe fallback paths and repository-escaping instruction symlinks while keeping all analysis local.

## 0.10.0 — 2026-08-26

- Add `instructree explain <file> --client codex` for the actual repository project-instruction chain.
- Apply Codex precedence by choosing the first non-empty `AGENTS.override.md`, otherwise `AGENTS.md`, in each directory from the repository root through the target directory.
- Keep neutral cross-client `explain` behavior unchanged and reject ambiguous `--client codex --effective` combinations.
- Include explicit `codex` client/profile metadata in JSON output and document the repository-only boundary.

## 0.9.0 — 2026-08-26

- Discover Codex `AGENTS.override.md` files at repository and nested directory scope.
- Label overrides as Codex-specific guidance while keeping cross-client `AGENTS.md` files visible.
- Keep Codex overrides outside GitHub Copilot CLI `@path` import expansion to avoid unsupported missing-import diagnostics.
- Refresh the native Codex skill fallback to the audited override-aware implementation.

## 0.8.0 — 2026-08-26

- Add `instructree init [root] --code-scanning` to scaffold a least-privilege, fork-safe SARIF workflow.

## 0.7.1 — 2026-08-26

- Publish Instructree diagnostics to GitHub code scanning through a first-party SARIF workflow.
- Add MIT license metadata and an immutable executable fallback to the native Agent Skill.
- Protect published `v*` tags from updates and deletion.
- Document the first-party `gh skill install` path for Codex.

## 0.7.0 — 2026-08-26

- Add `instructree init [root]` to scaffold a pinned, read-only GitHub Actions workflow.
- Refuse to overwrite an existing workflow or write through symlinked workflow directories.
- Document the one-command CI onboarding path.

## 0.6.0 — 2026-08-26

- Add `scan --sarif` output compatible with SARIF 2.1.0 and GitHub code scanning.
- Emit stable rule metadata, repository-relative artifact URIs, line locations, and native severity levels.
- Reject ambiguous `--json --sarif` combinations and limit SARIF output to repository scans.

## 0.5.0 — 2026-08-26

- Discover direct-child and nested skills in standalone catalogs.
- Ignore fenced and inline examples, plus skill resource templates, during active-instruction analysis.
- Skip scoped conflict comparisons when file extensions prove their path globs disjoint.
- Avoid conflict noise from directive headings and aligned alternatives in compound rules.
- Accept namespaced skill names in nested catalogs while retaining ordinary folder-name warnings.
- Add a pinned, reproducible real-world compatibility report.

## 0.4.0 — 2026-08-26

- Add a dependency-free GitHub Action with native file-and-line annotations.
- Add `root` and `strict` action inputs with repository-boundary validation.
- Exercise the action itself across the full CI operating-system and Node matrix.

## 0.3.0 — 2026-08-26

- Add a native Instructree skill for Codex and compatible coding agents.
- Discover distributable skills stored under top-level `skills/` directories.
- Document a focused, reproducible Codex engineering and launch setup.

## 0.2.0 — 2026-08-25

- Add recursive GitHub Copilot CLI `@path` import graphs.
- Detect missing, absolute, out-of-repository, cyclic, duplicate, oversized, and over-depth imports.
- Add `instructree imports` with focused text and JSON reports.
- Add `instructree explain <file> --effective` for transitive instruction files.
- Guard against symlink-based repository escapes and ignore import examples inside fenced code blocks.

## 0.1.0 — 2026-08-25

- Discover common coding-agent instruction, skill, agent, and workflow formats.
- Validate metadata, duplicate skill names, local links, and conservative instruction conflicts.
- Add path explanation, JSON output, strict CI policy, and a zero-dependency Node.js CLI.
