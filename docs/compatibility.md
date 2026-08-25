# Real-world compatibility

Instructree v0.5.0 was checked against pinned snapshots of three public skill catalogs on 2026-08-26. The goal was to find unsupported layouts and false positives using real files, then preserve the results as a repeatable product test.

| Catalog snapshot | v0.4.0 baseline | v0.5.0 | Result |
| --- | ---: | ---: | --- |
| [`github/awesome-copilot@d0d9d9f`](https://github.com/github/awesome-copilot/tree/d0d9d9f014abb27bf0d8321851867500a3a46bba) | 633 files, 255 diagnostics | 632 files, 4 diagnostics | 0 errors; 2 scope notes and 2 conflict warnings remain for review |
| [`composio-community/awesome-codex-skills@0930e13`](https://github.com/composio-community/awesome-codex-skills/tree/0930e1373789d2eda449039f7ac154b33031de89) | 0 files, 0 diagnostics | 48 files, 1 diagnostic | Standalone catalog layout is now discovered; one folder/name warning remains |
| [`vercel-labs/skills@435076e`](https://github.com/vercel-labs/skills/tree/435076e78988e1e6ec40d00b0b1d76bdbbc5419a) | 2 files, 0 diagnostics | 2 files, 0 diagnostics | Clean |

The v0.5.0 pass changed five compatibility boundaries:

- direct-child and nested skill catalogs are discovered;
- `assets`, `references`, and `scripts` inside skills are treated as resources, not active repository instructions;
- fenced and inline examples do not create link or directive diagnostics;
- scoped rules with provably disjoint file extensions are not compared;
- compound directives are compared by their leading clause, so an aligned alternative is not mistaken for a contradiction;
- nested namespaced skills such as `qdrant-monitoring-debugging` are accepted when the leaf folder is `debugging`.

## Reproduce

Check out each repository at the commit linked above, then run both versions from the Instructree repository root:

```bash
npx --yes github:kotobuki09/instructree#v0.4.0 scan <catalog-checkout> --json
npx --yes github:kotobuki09/instructree#v0.5.0 scan <catalog-checkout> --json
```

Group the returned `diagnostics` by `code` to reproduce the counts. For the candidate before its tag exists, replace the second command with:

```bash
node bin/instructree.js scan <catalog-checkout> --json
```

These counts describe Instructree's static analysis against immutable snapshots; they are not a quality judgment about the upstream repositories. Conflict diagnostics are deliberately heuristic and require human review. The audit does not execute skills or test agent runtime behavior.
