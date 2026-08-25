# Codex instruction and skill doctor

Checked on 2026-08-26 against OpenAI Codex main commit `0b94751cc463d02dec397c4c4dbb77fd9b93d94d`, local `codex-cli 0.149.1`, and current GitHub issue state.

## User need

Open [openai/codex#30788](https://github.com/openai/codex/issues/30788) asks for a deterministic, pre-session `codex debug agents-md` command. The requested report should identify the selected project root, configured root markers, broad-to-specific instruction files, byte contribution and truncation, override selection, user-scope instructions, and a JSON form suitable for CI or issue reports.

That debug surface is still absent. The current pinned [`DebugSubcommand`](https://github.com/openai/codex/blob/0b94751cc463d02dec397c4c4dbb77fd9b93d94d/codex-rs/cli/src/main.rs#L238-L262) exposes models, app-server tooling, and prompt-input, but no focused AGENTS.md command. The locally installed `codex-cli 0.149.1` reports the same public subcommands.

## Current discovery behavior

Codex documents the project walk directly in its pinned [`agents_md.rs`](https://github.com/openai/codex/blob/0b94751cc463d02dec397c4c4dbb77fd9b93d94d/codex-rs/core/src/agents_md.rs#L1-L16): find the nearest ancestor containing a configured root marker, default to `.git`, then walk from that root to the current working directory without walking above the root. An empty marker list disables parent traversal.

The implementation:

- merges non-project configuration layers before resolving [`project_root_markers`](https://github.com/openai/codex/blob/0b94751cc463d02dec397c4c4dbb77fd9b93d94d/codex-rs/core/src/agents_md.rs#L185-L217);
- selects the first regular file in each directory using `AGENTS.override.md`, `AGENTS.md`, then unique non-empty configured fallbacks ([candidate selection](https://github.com/openai/codex/blob/0b94751cc463d02dec397c4c4dbb77fd9b93d94d/codex-rs/core/src/agents_md.rs#L237-L280));
- reads selected files broad to specific and spends one shared byte budget, truncating the current file when necessary and skipping whitespace-only content ([budget application](https://github.com/openai/codex/blob/0b94751cc463d02dec397c4c4dbb77fd9b93d94d/codex-rs/core/src/agents_md.rs#L121-L175));
- skips project instructions entirely for an explicitly untrusted project ([trust boundary](https://github.com/openai/codex/blob/0b94751cc463d02dec397c4c4dbb77fd9b93d94d/codex-rs/core/src/agents_md.rs#L53-L65)).

The pinned configuration model defines a default 32 KiB `project_doc_max_bytes` and ordered `project_doc_fallback_filenames` ([definitions](https://github.com/openai/codex/blob/0b94751cc463d02dec397c4c4dbb77fd9b93d94d/codex-rs/config/src/config_toml.rs#L73-L84), [fields](https://github.com/openai/codex/blob/0b94751cc463d02dec397c4c4dbb77fd9b93d94d/codex-rs/config/src/config_toml.rs#L295-L301)). `project_root_markers` defaults to `.git`; an explicit empty array disables root detection ([parser](https://github.com/openai/codex/blob/0b94751cc463d02dec397c4c4dbb77fd9b93d94d/codex-rs/config/src/project_root_markers.rs#L5-L46)).

User-scope instructions are separate from the project byte budget. Codex checks `AGENTS.override.md` before `AGENTS.md` in the Codex home and selects the first readable, non-empty file ([user instruction provider](https://github.com/openai/codex/blob/0b94751cc463d02dec397c4c4dbb77fd9b93d94d/codex-rs/codex-home/src/instructions/mod.rs#L9-L60)).

## Bounded Instructree opportunity

A single `instructree doctor [cwd]` command can compose Instructree's existing project-chain and skill audits into one share-safe report:

- read only the supported top-level project-instruction settings from user `~/.codex/config.toml`;
- honor the supported user root markers, fallbacks, and byte budget;
- report the selected user-scope instruction file without printing its contents;
- report the project chain for the current directory, plus truncation and structural diagnostics;
- summarize skill candidates, user-config-disabled skills, duplicates, metadata failures, and context pressure;
- expose deterministic JSON while redacting absolute home and repository paths.

The report must not claim to reproduce a live or resumed Codex session. Managed configuration, session flags, profiles, project trust, remote environments, plugins, product restrictions, and project configuration can change the runtime result. Unsupported relevant syntax must be reported and must not be partially applied.
