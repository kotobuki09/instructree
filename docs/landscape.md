# Why Instructree exists

This project started from a small, current ecosystem observation: coding-agent instructions are becoming more useful and more fragmented at the same time.

- VS Code documents repository-wide `.github/copilot-instructions.md`, `AGENTS.md`, and `CLAUDE.md`, plus path-scoped `*.instructions.md`; nested `AGENTS.md` behavior is still described as experimental. ([source](https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/custom-instructions.md))
- Codex documents `AGENTS.override.md` as a higher-precedence override for global and per-directory project instructions. ([source](https://developers.openai.com/codex/guides/agents-md))
- GitHub's customization matrix now spans custom instructions, skills, hooks, MCP servers, custom agents, and subagents, with different support by surface. ([source](https://docs.github.com/en/copilot/reference/customization-cheat-sheet))
- Agent Skills are supported from `.github/skills`, `.claude/skills`, and `.agents/skills`, creating a useful cross-client validation target. ([source](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills))
- GitHub Agentic Workflows add Markdown files with executable workflow metadata such as `on`, `permissions`, and `safe-outputs`. ([source](https://docs.github.com/en/copilot/how-tos/github-agentic-workflows/creating-github-agentic-workflows))

Instructree deliberately stops at deterministic local facts: file discovery, metadata, path patterns, links, duplicate identifiers, and conservative conflict hints. It does not claim to know exactly what an evolving client or model will do.
