# Codex setup

Instructree ships as both a CLI and an agent skill. With GitHub CLI 2.90 or later, install the versioned skill at user scope for Codex:

```bash
gh skill install kotobuki09/instructree instructree@v0.11.0 --agent codex --scope user
```

Alternatively, use the cross-agent installer:

```bash
npx skills add kotobuki09/instructree --skill instructree -g --agent codex
```

The skill tells Codex when to scan the repository, trace recursive imports, or explain the instruction scope for one file. For a Codex target, `instructree explain <file> --client codex` reports the repository project-instruction chain using Codex override precedence. Add repeatable `--fallback <filename>` values and `--max-bytes <non-negative-integer>` to mirror `project_doc_fallback_filenames` and `project_doc_max_bytes` explicitly. It asks before downloading the CLI when no local command is available.

To add the same secure SARIF checks to a repository, run:

```bash
npx --yes github:kotobuki09/instructree#v0.11.0 init --code-scanning
```

The generated workflow uses least-privilege permissions, avoids privileged SARIF uploads from forked pull requests, and refuses to overwrite an existing workflow.

Instructree recognizes Codex-specific `AGENTS.override.md` files described in the official [OpenAI Codex AGENTS.md guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md). They are shown with normal directory scope in `scan` and neutral `explain`, while `explain --client codex` resolves the first existing regular candidate per directory, even when that candidate is empty. Its JSON output reports the configured fallbacks, shared byte budget, included bytes, and truncation state. The empty-candidate and byte-budget details are checked against the pinned [Codex implementation](https://github.com/openai/codex/blob/9be8d6e1c3dbb145d2d7ac3ba46729340e6d8d40/codex-rs/core/src/agents_md.rs). Codex overrides remain outside GitHub Copilot CLI `@path` import expansion.

## Audit the installed skill stack

Before adding or troubleshooting skills, inspect the scopes Codex can see from a checkout:

```bash
instructree skills . --client codex --json
```

The report includes the user `~/.agents/skills` catalog and every repository-local `.agents/skills` candidate scope from the current directory to the repository root. It follows symlinked skill folders, keeps paths logical instead of exposing absolute home directories, and highlights possible duplicate names, missing or malformed `name`/`description` metadata, and an approximate initial-list character estimate that includes each skill's name, description, and logical path. The estimate is compared with the documented 8,000-character reference used when the context window is unknown; Codex otherwise uses at most 2% of the model context, which can differ. `--home <home>` is an optional testing or inspection override. This command is read-only, excludes admin/system skills, does not read `~/.codex/config.toml`, and therefore cannot report config-enabled state or the exact skills loaded for a run. Semantics are grounded in the official [Codex skills documentation](https://developers.openai.com/codex/skills).

## Focused companion stack

This is a deliberately small stack. Popularity is a filter, not a reason to load unrelated instructions into every task.

| Need | Skill | Why it is included |
| --- | --- | --- |
| Discover a missing capability | [`vercel-labs/skills@find-skills`](https://skills.sh/vercel-labs/skills/find-skills) | Official directory discovery workflow and the top all-time skill when reviewed on 2026-08-26. |
| Review a change | [`mattpocock/skills@code-review`](https://skills.sh/mattpocock/skills/code-review) | High-adoption, evidence-first review workflow. |
| Develop against tests | [`mattpocock/skills@tdd`](https://skills.sh/mattpocock/skills/tdd) | High-adoption test-driven implementation loop. |
| Verify before claiming completion | [`obra/superpowers@verification-before-completion`](https://skills.sh/obra/superpowers/verification-before-completion) | Requires fresh command evidence before completion claims. |
| Research current ecosystems | [`mattpocock/skills@research`](https://skills.sh/mattpocock/skills/research) | Source-grounded research for changing tools and distribution channels. |
| Plan positioning and launch | [`phuryn/pm-skills@gtm-strategy`](https://skills.sh/phuryn/pm-skills/gtm-strategy) | Covers channels, messaging, metrics, and launch timing from an active, established skill repository. |

Install only missing skills. Review the linked `SKILL.md` before installation because skills influence agent decisions.

```bash
npx skills add vercel-labs/skills@find-skills -g --agent codex
npx skills add mattpocock/skills@code-review -g --agent codex
npx skills add mattpocock/skills@tdd -g --agent codex
npx skills add obra/superpowers@verification-before-completion -g --agent codex
npx skills add mattpocock/skills@research -g --agent codex
npx skills add phuryn/pm-skills@gtm-strategy -g --agent codex
```

The first five are engineering guardrails; the final skill is for positioning and launch work. Do not invoke it during ordinary implementation.
