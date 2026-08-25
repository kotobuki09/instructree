# Changelog

All notable changes to Instructree are documented here.

## 0.5.0 — 2026-08-26

- Discover direct-child and nested skills in standalone catalogs.
- Ignore fenced and inline examples, plus skill resource templates, during active-instruction analysis.
- Skip scoped conflict comparisons when file extensions prove their path globs disjoint.
- Avoid conflict noise from directive headings and aligned alternatives in compound rules.
- Accept namespaced skill names in nested catalogs while retaining ordinary folder-name warnings.
- Add a pinned, reproducible real-world compatibility report.

## 0.4.0 — 2026-08-26

- Add a dependency-free GitHub Action with native file-and-line annotations.
- Add `root` and `strict` action inputs with repository-boundary validation.
- Exercise the action itself across the full CI operating-system and Node matrix.

## 0.3.0 — 2026-08-26

- Add a native Instructree skill for Codex and compatible coding agents.
- Discover distributable skills stored under top-level `skills/` directories.
- Document a focused, reproducible Codex engineering and launch setup.

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
