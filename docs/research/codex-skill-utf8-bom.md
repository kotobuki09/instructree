# Codex skill frontmatter and UTF-8 BOM

Checked on 2026-08-26 against OpenAI Codex main commit `f6805328c434eebb032bced0da29e39ba6dc3aee`.

## User-visible failure

[openai/codex#13918](https://github.com/openai/codex/issues/13918) reports that a valid `SKILL.md` saved as UTF-8 with a byte-order mark (`EF BB BF`) is skipped with the misleading message `missing YAML frontmatter delimited by ---`. The report is labeled as a Windows skill-loader bug and remains open.

## Current source behavior

Codex's current [`extract_frontmatter`](https://github.com/openai/codex/blob/f6805328c434eebb032bced0da29e39ba6dc3aee/codex-rs/skills/src/parser.rs#L200-L220) reads the first line and requires its trimmed value to equal `---`. The parser does not strip or diagnose a leading UTF-8 BOM before this check.

## Instructree compatibility rule

Instructree should parse the metadata behind a leading UTF-8 BOM so that `name` and `description` do not produce cascading false errors, while emitting one precise error explaining that current Codex versions may skip the skill and that the file should be saved as UTF-8 without BOM.

This rule is deliberately limited to a BOM immediately before valid skill frontmatter. It does not claim that all Markdown consumers reject BOMs, and it does not silently rewrite files.
