# Contributor instructions

- Keep Instructree dependency-free at runtime.
- Use Node.js built-ins and support Node.js 20 or newer.
- Add or update a focused `node:test` case for every behavior change.
- Preserve deterministic output: sort discovered paths and diagnostics.
- Describe heuristic findings as possible conflicts, never as proven agent behavior.
- Run `npm test` and `npm run check` before submitting a change.
