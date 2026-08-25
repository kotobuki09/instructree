# Contributing to Instructree

Thanks for helping make coding-agent instructions easier to reason about.

## Development

You need Node.js 20 or newer. There are no runtime or development dependencies.

```bash
git clone https://github.com/kotobuki09/instructree.git
cd instructree
npm test
npm run check
node bin/instructree.js
```

Please keep pull requests focused. Add a `node:test` fixture for behavior changes and link the primary documentation for any new agent format or validation rule. Diagnostics must be deterministic, include a file and line, and avoid claiming that a heuristic is certain.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
