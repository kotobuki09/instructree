# Codex setup

Instructree ships as both a CLI and an agent skill. With GitHub CLI 2.90 or later, install the versioned skill at user scope for Codex:

```bash
gh skill install kotobuki09/instructree instructree@v0.8.0 --agent codex --scope user
```

Alternatively, use the cross-agent installer:

```bash
npx skills add kotobuki09/instructree --skill instructree -g --agent codex
```

The skill tells Codex when to scan the repository, trace recursive imports, or explain the instruction scope for one file. It asks before downloading the CLI when no local command is available.

To add the same secure SARIF checks to a repository, run:

```bash
npx --yes github:kotobuki09/instructree#v0.8.0 init --code-scanning
```

The generated workflow uses least-privilege permissions, avoids privileged SARIF uploads from forked pull requests, and refuses to overwrite an existing workflow.

Instructree recognizes Codex-specific `AGENTS.override.md` files described in the official [OpenAI Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md). They are shown with normal directory scope in `scan` and `explain`, while remaining outside GitHub Copilot CLI `@path` import expansion.

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
