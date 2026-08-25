# Codex project-root boundary research

Last verified: 2026-08-26.

## User problem

Codex stops project-instruction discovery at the nearest configured project-root marker. That is deterministic, but a nested marker can make plausible parent instructions silently invisible. This occurs with Git submodules and worktrees, and it can also occur when an accidental nested `.git` entry is present.

- [openai/codex#25651](https://github.com/openai/codex/issues/25651) records a real troubleshooting case where an empty nested `.git` directory made Codex treat a subtree as the project root. An OpenAI collaborator confirmed that Codex uses filesystem markers and does not require the marker to be a functional Git repository.
- [openai/codex#30789](https://github.com/openai/codex/issues/30789) requests an explicit warning when a submodule boundary hides a superproject `AGENTS.md`.
- [openai/codex#30788](https://github.com/openai/codex/issues/30788) separately requests a focused, deterministic pre-session command for inspecting AGENTS.md discovery.

## Pinned implementation behavior

The current Codex implementation was inspected at commit [`4213b38f3c555049bf6f494065698a3dfe587c16`](https://github.com/openai/codex/commit/4213b38f3c555049bf6f494065698a3dfe587c16).

- The module contract states that discovery does not walk past the project root: [`agents_md.rs` lines 8–16](https://github.com/openai/codex/blob/4213b38f3c555049bf6f494065698a3dfe587c16/codex-rs/core/src/agents_md.rs#L8-L16).
- Root selection uses the configured markers and the nearest ancestor containing one: [`agents_md.rs` lines 202–217](https://github.com/openai/codex/blob/4213b38f3c555049bf6f494065698a3dfe587c16/codex-rs/core/src/agents_md.rs#L202-L217).
- The search path is then constructed only from that selected root down to the working directory: [`agents_md.rs` lines 218–235](https://github.com/openai/codex/blob/4213b38f3c555049bf6f494065698a3dfe587c16/codex-rs/core/src/agents_md.rs#L218-L235).
- In each directory, Codex selects the first regular candidate in override, standard, then configured-fallback order: [`agents_md.rs` lines 237–264](https://github.com/openai/codex/blob/4213b38f3c555049bf6f494065698a3dfe587c16/codex-rs/core/src/agents_md.rs#L237-L264) and [`agents_md.rs` lines 267–278](https://github.com/openai/codex/blob/4213b38f3c555049bf6f494065698a3dfe587c16/codex-rs/core/src/agents_md.rs#L267-L278).

## Instructree boundary

`instructree doctor` performs one extra, read-only diagnostic walk above the selected root. It retains candidate precedence, stops at the nearest outer marker, and reports only redacted labels such as `<parent>/AGENTS.md`. It does not add those files to the effective chain, read their contents, or claim that Codex loaded them.

The signal is intentionally limited to nested project boundaries. If no outer configured marker exists, parent candidates are not reported as hidden project instructions. Filesystem inspection failures are reported with redacted paths, and unsupported relevant user configuration still makes the project preview unavailable.
