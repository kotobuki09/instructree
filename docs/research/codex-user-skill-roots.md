# Codex user skill roots

Checked on 2026-08-26 against OpenAI Codex main commit `75cb7c903d474b6637a6e9fe6f76cedf76ef1472`, the official Codex skills documentation, and GitHub CLI 2.96.0.

## Current behavior

The official [Codex skills documentation](https://developers.openai.com/codex/skills) identifies `$HOME/.agents/skills` as the user-level location shared across repositories. Current Codex source also loads the deprecated `$CODEX_HOME/skills` user location for backward compatibility before loading `$HOME/.agents/skills`; the exact roots and ordering are visible in the pinned [`host_roots.rs`](https://github.com/openai/codex/blob/75cb7c903d474b6637a6e9fe6f76cedf76ef1472/codex-rs/ext/skills/src/host_roots.rs#L80-L112).

GitHub CLI's [`gh skill install` manual](https://cli.github.com/manual/gh_skill_install) describes user scope as host-specific and the shared project location as `.agents/skills`. In a Windows check with GitHub CLI 2.96.0, `gh skill install ... --agent codex --scope user` installed into `~/.codex/skills`, the deprecated root that Codex still supports.

## Instructree compatibility boundary

Instructree audits both default user roots so a GitHub CLI-installed skill is not falsely reported as missing and a same-name skill in both roots is visible as a duplicate. It labels the roots separately, deduplicates canonical targets such as symlink aliases, and continues to skip hidden descendants such as `.system`.

The audit is read-only. It does not migrate, delete, enable, install, or execute skills. It resolves the default deprecated `~/.codex/skills` location, not a custom `CODEX_HOME`, and therefore remains a bounded static preview rather than a claim about the exact skill set loaded by a live session.
