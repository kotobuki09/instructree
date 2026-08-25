import fs from "node:fs/promises";
import path from "node:path";
import { CODEX_SKILL_UTF8_BOM_MESSAGE, listValue, parseFrontmatter } from "./frontmatter.js";

function diagnostic(file, severity, code, line, message) {
  return { file: file.path, severity, code, line, message };
}

function isNestedCatalogSkill(filePath) {
  const segments = filePath.split("/");
  if (segments[0] === "skills") return segments.length > 3;
  return [".agents", ".claude", ".github"].includes(segments[0]) && segments[1] === "skills" && segments.length > 4;
}

function validateFrontmatter(file, parsed) {
  const diagnostics = [];
  if (file.kind === "skill" && parsed.present && parsed.utf8Bom) {
    diagnostics.push(diagnostic(file, "error", "E005", 1, CODEX_SKILL_UTF8_BOM_MESSAGE));
  }
  diagnostics.push(...parsed.errors.map((error) =>
    diagnostic(file, "error", "E001", error.line, error.message),
  ));
  if (parsed.errors.length > 0) return diagnostics;

  if (["skill", "agent", "workflow"].includes(file.kind) && !parsed.present) {
    diagnostics.push(diagnostic(file, "error", "E002", 1, `${file.kind} files require YAML frontmatter`));
    return diagnostics;
  }

  const required = {
    skill: ["name", "description"],
    agent: ["description"],
    workflow: ["on", "permissions", "safe-outputs"],
  }[file.kind] ?? [];

  for (const key of required) {
    const requiresScalarValue = file.kind !== "workflow";
    if (!Object.hasOwn(parsed.data, key) || (requiresScalarValue && parsed.data[key] === "")) {
      diagnostics.push(diagnostic(file, "error", "E003", 1, `missing required frontmatter field '${key}'`));
    }
  }

  if (file.kind === "scoped" && parsed.present && file.patternKey && !parsed.data[file.patternKey]) {
    diagnostics.push(
      diagnostic(
        file,
        "note",
        "I101",
        1,
        `no '${file.patternKey}' pattern; this file is not automatically path-scoped`,
      ),
    );
  }

  if (file.kind === "skill" && parsed.data.name) {
    const name = String(parsed.data.name);
    const folderName = path.posix.basename(path.posix.dirname(file.path));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      diagnostics.push(
        diagnostic(file, "error", "E004", parsed.keyLines.name ?? 1, "skill name must use lower-case kebab-case"),
      );
    }
    const namespacedNestedName = isNestedCatalogSkill(file.path) && name.endsWith(`-${folderName}`);
    if (name !== folderName && !namespacedNestedName) {
      diagnostics.push(
        diagnostic(
          file,
          "warning",
          "W101",
          parsed.keyLines.name ?? 1,
          `skill name '${name}' does not match its folder '${folderName}'`,
        ),
      );
    }
  }

  return diagnostics;
}

function unfencedLines(content) {
  const visible = [];
  let fence = null;
  for (const [index, text] of content.replace(/\r\n/g, "\n").split("\n").entries()) {
    const match = text.match(/^\s*(`{3,}|~{3,})/);
    if (match) {
      const marker = match[1][0];
      if (!fence) fence = { marker, length: match[1].length };
      else if (fence.marker === marker && match[1].length >= fence.length) fence = null;
      continue;
    }
    if (!fence) visible.push({ text, line: index + 1 });
  }
  return visible;
}

function localMarkdownLinks(content) {
  const links = [];
  for (const source of unfencedLines(content)) {
    const prose = source.text.replace(/(`+).*?\1/g, "");
    for (const match of prose.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const destination = match[1].trim().replace(/^<|>$/g, "").split(/\s+["']/)[0];
      if (!destination || /^(?:[a-z]+:|#)/i.test(destination)) continue;
      links.push({ destination: destination.split("#")[0], line: source.line });
    }
  }
  return links;
}

async function validateLinks(file, content) {
  const diagnostics = [];
  for (const link of localMarkdownLinks(content)) {
    let destination;
    try {
      destination = decodeURIComponent(link.destination);
    } catch {
      diagnostics.push(diagnostic(file, "warning", "W201", link.line, `invalid link encoding '${link.destination}'`));
      continue;
    }
    const absolute = path.resolve(path.dirname(file.absolutePath), destination);
    try {
      await fs.access(absolute);
    } catch {
      diagnostics.push(diagnostic(file, "warning", "W202", link.line, `broken local link '${link.destination}'`));
    }
  }
  return diagnostics;
}

function directiveFromLine(rawLine, line) {
  const firstClause = rawLine
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .split(/;\s*|\.\s+/)[0]
    .split(/[:(]\s*(?=(?:you\s+)?(?:must\s+not|do\s+not|don't|never|avoid|must|always|use|prefer|required?:?))/i)[0];
  const text = firstClause
    .replace(/[`*_]/g, "")
    .trim();
  if (text.length < 8 || text.startsWith("#") || text.endsWith(":")) return null;

  const negative = text.match(/^(?:you\s+)?(?:must\s+not|do\s+not|don't|never|avoid)\s+(?:use\s+)?(.+?)[.!]?$/i);
  const positive = text.match(/^(?:you\s+)?(?:must|always|use|prefer|required?:?)\s+(?:use\s+)?(.+?)[.!]?$/i);
  const match = negative ?? positive;
  if (!match) return null;

  const tokens = match[1]
    .toLowerCase()
    .replace(/[^a-z0-9@/._+-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !["the", "and", "for", "new", "with", "that", "this"].includes(token));
  if (tokens.length === 0) return null;
  return { polarity: negative ? "negative" : "positive", tokens: new Set(tokens), line, text };
}

function directives(file) {
  return unfencedLines(file.content)
    .map(({ text, line }) => directiveFromLine(text, line))
    .filter(Boolean);
}

function similarity(left, right) {
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.min(left.size, right.size);
}

function constrainedExtensions(pattern) {
  const match = pattern.replace(/\s/g, "").match(/\.([a-z0-9]+|\{[a-z0-9,]+\})$/i);
  if (!match) return null;
  return new Set(match[1].replace(/^\{|\}$/g, "").split(","));
}

function patternsMayOverlap(leftPatterns, rightPatterns) {
  if (leftPatterns.length === 0 || rightPatterns.length === 0) return false;
  return leftPatterns.some((left) =>
    rightPatterns.some((right) => {
      const leftExtensions = constrainedExtensions(left);
      const rightExtensions = constrainedExtensions(right);
      if (!leftExtensions || !rightExtensions) return true;
      return [...leftExtensions].some((extension) => rightExtensions.has(extension));
    }),
  );
}

function scopesCanOverlap(left, right) {
  if (left.kind === "skill" || right.kind === "skill" || left.kind === "agent" || right.kind === "agent") return false;
  if (left.kind === "workflow" || right.kind === "workflow") return false;
  if (left.kind === "scoped" && right.kind === "scoped") {
    return patternsMayOverlap(left.patterns, right.patterns);
  }
  if ((left.kind === "scoped" && left.patterns.length === 0) || (right.kind === "scoped" && right.patterns.length === 0)) {
    return false;
  }
  if (left.kind === "always" && right.kind === "always") {
    return (
      left.scope === "." ||
      right.scope === "." ||
      left.scope.startsWith(`${right.scope}/`) ||
      right.scope.startsWith(`${left.scope}/`)
    );
  }
  return true;
}

function findConflicts(files) {
  const diagnostics = [];
  for (let leftIndex = 0; leftIndex < files.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < files.length; rightIndex += 1) {
      const left = files[leftIndex];
      const right = files[rightIndex];
      if (!scopesCanOverlap(left, right)) continue;

      for (const leftDirective of directives(left)) {
        for (const rightDirective of directives(right)) {
          if (leftDirective.polarity === rightDirective.polarity) continue;
          if (similarity(leftDirective.tokens, rightDirective.tokens) < 0.8) continue;
          diagnostics.push(
            diagnostic(
              right,
              "warning",
              "W301",
              rightDirective.line,
              `possible conflict with ${left.path}:${leftDirective.line} — review '${rightDirective.text}'`,
            ),
          );
        }
      }
    }
  }
  return diagnostics;
}

function findDuplicateSkills(files) {
  const diagnostics = [];
  const seen = new Map();
  for (const file of files.filter((entry) => entry.kind === "skill")) {
    const name = String(file.frontmatter.data.name ?? "");
    if (!name) continue;
    if (seen.has(name)) {
      diagnostics.push(
        diagnostic(file, "error", "E201", file.frontmatter.keyLines.name ?? 1, `duplicate skill name '${name}' also used by ${seen.get(name)}`),
      );
    } else {
      seen.set(name, file.path);
    }
  }
  return diagnostics;
}

export async function analyze(discoveredFiles) {
  const files = [];
  const diagnostics = [];

  for (const file of discoveredFiles) {
    const content = await fs.readFile(file.absolutePath, "utf8");
    const frontmatter = parseFrontmatter(content);
    const patterns = file.patternKey ? listValue(frontmatter.data[file.patternKey]) : [];
    const analyzed = { ...file, content, frontmatter, patterns };
    files.push(analyzed);
    diagnostics.push(...validateFrontmatter(analyzed, frontmatter));
    diagnostics.push(...(await validateLinks(analyzed, content)));
  }

  diagnostics.push(...findDuplicateSkills(files));
  diagnostics.push(...findConflicts(files));
  diagnostics.sort((left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line || left.code.localeCompare(right.code),
  );
  return { files, diagnostics };
}
