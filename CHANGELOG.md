# Changelog

All notable changes to Instructree are documented here.

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
