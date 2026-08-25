import test from "node:test";
import assert from "node:assert/strict";
import { listValue, parseFrontmatter } from "../src/frontmatter.js";

test("parses scalar and list frontmatter values", () => {
  const parsed = parseFrontmatter(`---
name: typescript-rules
applyTo: "**/*.ts, **/*.tsx"
paths:
  - src/**/*.js
  - test/**/*.js
---
# Rules
`);

  assert.equal(parsed.present, true);
  assert.equal(parsed.data.name, "typescript-rules");
  assert.deepEqual(listValue(parsed.data.applyTo), ["**/*.ts", "**/*.tsx"]);
  assert.deepEqual(parsed.data.paths, ["src/**/*.js", "test/**/*.js"]);
  assert.equal(parsed.errors.length, 0);
});

test("reports an unclosed frontmatter block", () => {
  const parsed = parseFrontmatter("---\nname: broken\n");
  assert.equal(parsed.errors[0].line, 1);
  assert.match(parsed.errors[0].message, /closing/);
});

test("parses folded and literal YAML block scalars", () => {
  const folded = parseFrontmatter(`---
name: block-scalar
description: >-
  Review changed code
  before merging.
---
Body
`);
  const literal = parseFrontmatter(`---
name: literal
description: |
  First line.
  Second line.
---
`);

  assert.equal(folded.data.description, "Review changed code before merging.");
  assert.equal(folded.body, "Body\n");
  assert.equal(literal.data.description, "First line.\nSecond line.\n");
});
