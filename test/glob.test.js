import test from "node:test";
import assert from "node:assert/strict";
import { matchesGlob } from "../src/glob.js";

test("matches common instruction globs", () => {
  assert.equal(matchesGlob("src/index.ts", "**/*.ts"), true);
  assert.equal(matchesGlob("index.ts", "**/*.ts"), true);
  assert.equal(matchesGlob("src/index.js", "**/*.{js,ts}"), true);
  assert.equal(matchesGlob("src/index.py", "**/*.{js,ts}"), false);
  assert.equal(matchesGlob("docs/guide.md", "docs/**"), true);
});
