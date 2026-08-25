import fs from "node:fs/promises";
import path from "node:path";
import { listValue, parseFrontmatter } from "./frontmatter.js";

function diagnostic(file, severity, code, line, message) {
  return { file: file.path, severity, code, line, message };
}

function validateFrontmatter(file, parsed) {
  const diagnostics = parsed.errors.map((error) =>
    diagnostic(file, "error", "E001", error.line, error.message),
  );
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
    if (name !== folderName) {
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

function localMarkdownLinks(content) {
  const links = [];
  const expression = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of content.matchAll(expression)) {
    const destination = match[1].trim().replace(/^<|>$/g, "").split(/\s+["']/)[0];
    if (!destination || /^(?:[a-z]+:|#)/i.test(destination)) continue;
    const before = content.slice(0, match.index);
    links.push({ destination: destination.split("#")[0], line: before.split(/\r?\n/).length });
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
  const text = rawLine
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/[`*_]/g, "")
    .trim();
  if (text.length < 8 || text.startsWith("#")) return null;

  const negative = text.match(/^(?:you\s+)?(?:must\s+not|do\s+not|don't|never|avoid)\s+(?:use\s+)?(.+?)[.!]?$/i);
  const positive = text.match(/^(?:you\s+)?(?:must|always|use|prefer|required?:?)\s+(?:use\s+)?(.+?)[.!]?$/i);
  const match = negative ?? positive;
  if (!match) return null;

  const tokens = match[1]
    .toLowerCase()
    .replace(/[^a-z0-9@/._+-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !["the", "and", "for", "with", "that", "this"].includes(token));
  if (tokens.length === 0) return null;
  return { polarity: negative ? "negative" : "positive", tokens: new Set(tokens), line, text };
}

function directives(file) {
  return file.content
    .split(/\r?\n/)
    .map((line, index) => directiveFromLine(line, index + 1))
    .filter(Boolean);
}

function similarity(left, right) {
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / Math.min(left.size, right.size);
}

function scopesCanOverlap(left, right) {
  if (left.kind === "skill" || right.kind === "skill" || left.kind === "agent" || right.kind === "agent") return false;
  if (left.kind === "workflow" || right.kind === "workflow") return false;
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
