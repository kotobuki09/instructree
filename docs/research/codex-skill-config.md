# Codex skill enablement configuration

Checked on 2026-08-26 against OpenAI Codex main commit `62bfa41a837a3c402ee1888ac0e25ea479083723` and the live OpenAI configuration schema.

## User need

Codex users are asking for an authoritative way to explain loaded context and skill state in [openai/codex#37242](https://github.com/openai/codex/issues/37242). More focused reports show that project-level skill filters are ignored ([#20210](https://github.com/openai/codex/issues/20210), [#24237](https://github.com/openai/codex/issues/24237), and [#29846](https://github.com/openai/codex/issues/29846)), making it difficult to tell whether a discovered skill is actually enabled.

## Current schema and resolution behavior

The live [Codex configuration schema](https://developers.openai.com/codex/config-schema.json) defines `skills.config` as an array of entries with required boolean `enabled` plus optional `name` or absolute `path` selectors. It also defines `skills.include_instructions`, `skills.max_context_tokens`, and `skills.bundled.enabled`.

Codex's pinned [`SkillConfig` and `SkillsConfig` definitions](https://github.com/openai/codex/blob/62bfa41a837a3c402ee1888ac0e25ea479083723/codex-rs/config/src/skills_config.rs#L20-L43) match that schema. Its [rule resolver](https://github.com/openai/codex/blob/62bfa41a837a3c402ee1888ac0e25ea479083723/codex-rs/config/src/skills_config.rs#L94-L190):

- accepts exactly one non-empty selector (`name` or `path`) per entry;
- canonicalizes path selectors when possible;
- applies rules in order, with later matching rules overriding earlier ones;
- applies a name rule to every discovered skill with that exact name;
- currently reads rules only from user and session-flag layers, not project layers.

The host service then [resolves disabled paths against discovered skill names and `SKILL.md` paths](https://github.com/openai/codex/blob/62bfa41a837a3c402ee1888ac0e25ea479083723/codex-rs/ext/skills/src/host_service.rs#L350-L365) before returning the skill snapshot.

## Instructree compatibility boundary

Instructree can safely improve its existing candidate-scope audit by reading the user-level `~/.codex/config.toml` and reporting:

- whether the file exists and could be parsed for the supported skill settings;
- effective user rules after same-selector overrides;
- discovered candidates disabled by those user rules;
- selectors that match no discovered candidate;
- invalid entries with both selectors, neither selector, a blank name, a non-boolean `enabled`, or an unsupported value form.

The report must remain read-only and redact absolute paths. It must not claim to be Codex's final loaded list because CLI session overrides, plugins, admin/system roots, product restrictions, and future source changes remain outside this bounded audit. Project-level `skills.config` must not be applied while current Codex main ignores that layer; the report may state this limitation explicitly.
