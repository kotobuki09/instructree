---
name: instructree
description: Map, explain, and lint repository-scoped coding-agent instructions. Use when auditing AGENTS.md, CLAUDE.md, Copilot instructions, agent skills, custom agents, or instruction conflicts before changing code.
license: MIT
metadata:
  short-description: Audit coding-agent instruction scope
---

# Instructree

Use Instructree to establish which instruction files exist, which may apply to a target, and whether their metadata or links are malformed.

## Run the audit

Work from the repository root. Prefer an already installed `instructree` command or the checked-out package's local binary. If neither is available, ask before downloading executable packages, then use the pinned release:

```bash
npx github:kotobuki09/instructree#9694f8d9d9af968acbfdb718cb1ef2fc6de2d47c scan .
```

Do not add `--yes` unless the user has authorized non-interactive package downloads.

Choose the narrowest command that answers the request:

- `instructree scan . --json` inventories supported files and emits stable diagnostics.
- `instructree explain <file> --root .` shows instructions that may apply to one target.
- `instructree explain <file> --root . --client codex` selects the Codex repository project-instruction chain.
- Add repeatable `--fallback <filename>` values and `--max-bytes <n>` when the Codex project configuration uses non-default fallbacks or byte limits.
- `instructree explain <file> --root . --effective` includes recursive Copilot CLI imports.
- `instructree imports . --json` audits the recursive `@path` graph.
- `instructree skills . --client codex --json` inventories Codex user and repository-local skill candidate scopes without installing or uploading anything. Omit `--client codex` because `skills` is Codex-specific; use optional `--home <home>` only to inspect a different user scope.
- `instructree scan . --sarif` emits SARIF 2.1.0 for code-scanning integrations.
- Add `--strict` only when warnings should fail the check.

## Interpret the result

Report file paths, line numbers, diagnostic codes, and the command's exit status. Separate schema or path errors from warnings. Describe `always`/`never` conflicts as possible conflicts requiring human review, not proof of agent behavior.

Instructree is static analysis. It does not upload repository content or call a model. Treat plain `explain` as a cross-client map of what may apply; use `--client codex` only for the documented repository project-instruction chain.

The `skills` inventory follows Codex's documented `~/.agents/skills` plus repository `.agents/skills` candidate-scope model, follows symlinked skill folders, and reports paths relative to the repository or as `~/.agents/skills/...`. It flags possible duplicate names, malformed metadata, and an approximate initial-list character estimate including name, description, and logical path. The 8,000-character comparison is only the unknown-context-window reference; Codex otherwise uses at most 2% of model context, and the logical redacted paths may differ from runtime paths. The inventory excludes admin/system skills and does not read `~/.codex/config.toml`, so it cannot identify config-disabled skills or claim an exact loaded list. Read the official [Codex skills documentation](https://developers.openai.com/codex/skills) when interpreting the estimate; it is not a prediction of model behavior.

Do not edit instruction files unless the user asked for changes. After an authorized fix, rerun the same command and report the before-and-after diagnostics.
