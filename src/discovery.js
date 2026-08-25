import fs from "node:fs/promises";
import path from "node:path";
import { globToRegExp } from "./glob.js";

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);
const SKILL_RESOURCE_DIRECTORIES = new Set(["assets", "references", "scripts"]);

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function compileIgnoreLine(rawLine) {
  let line = rawLine.trim();
  if (!line || line.startsWith("#")) return null;

  const negated = line.startsWith("!");
  if (negated) line = line.slice(1);
  const directoryOnly = line.endsWith("/");
  line = line.replace(/\/$/, "").replace(/^\//, "");
  if (!line) return null;

  const hasSlash = line.includes("/");
  const expression = globToRegExp(hasSlash ? line : `**/${line}`);
  const rootExpression = hasSlash ? null : globToRegExp(line);
  return { negated, directoryOnly, expression, rootExpression };
}

async function loadIgnoreRules(root) {
  try {
    const source = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    return source.split(/\r?\n/).map(compileIgnoreLine).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function isIgnored(relativePath, isDirectory, rules) {
  const normalized = normalize(relativePath);
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) continue;
    if (rule.expression.test(normalized) || rule.rootExpression?.test(normalized)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

export function classify(relativePath) {
  const normalized = normalize(relativePath);
  const lower = normalized.toLowerCase();
  const basename = path.posix.basename(normalized);
  const directory = path.posix.dirname(normalized) === "." ? "." : path.posix.dirname(normalized);

  if (basename === "AGENTS.md") {
    return { family: "AGENTS.md", kind: "always", scope: directory, patternKey: null };
  }
  if (basename === "CLAUDE.md" || basename === "CLAUDE.local.md") {
    return { family: "Claude", kind: "always", scope: directory, patternKey: null };
  }
  if (basename === "GEMINI.md") {
    return { family: "Gemini", kind: "always", scope: directory, patternKey: null };
  }
  if (lower === ".github/copilot-instructions.md") {
    return { family: "Copilot", kind: "always", scope: ".", patternKey: null };
  }
  if (lower.endsWith(".instructions.md")) {
    return { family: "Copilot", kind: "scoped", scope: ".", patternKey: "applyTo" };
  }
  if (lower.startsWith(".claude/rules/") && lower.endsWith(".md")) {
    return { family: "Claude", kind: "scoped", scope: ".", patternKey: "paths" };
  }
  if (lower.startsWith(".cursor/rules/") && lower.endsWith(".mdc")) {
    return { family: "Cursor", kind: "scoped", scope: ".", patternKey: "globs" };
  }
  if (lower.startsWith(".windsurf/rules/") && lower.endsWith(".md")) {
    return { family: "Windsurf", kind: "scoped", scope: ".", patternKey: "globs" };
  }
  if (lower.startsWith(".github/agents/") && lower.endsWith(".agent.md")) {
    return { family: "Copilot", kind: "agent", scope: ".", patternKey: null };
  }
  if (
    basename === "SKILL.md" &&
    (normalized.split("/").length === 2 ||
      ["skills/", ".agents/skills/", ".claude/skills/", ".github/skills/"].some((prefix) => lower.startsWith(prefix)))
  ) {
    return { family: "Skills", kind: "skill", scope: directory, patternKey: null };
  }
  if (lower.startsWith(".github/workflows/") && lower.endsWith(".md")) {
    return { family: "Agentic workflow", kind: "workflow", scope: ".", patternKey: null };
  }
  return null;
}

export async function discover(root) {
  const ignoreRules = await loadIgnoreRules(root);
  const found = [];

  async function walk(directory, relativeDirectory = "") {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const skillPath = relativeDirectory ? `${normalize(relativeDirectory)}/SKILL.md` : "SKILL.md";
    const isSkillDirectory =
      entries.some((entry) => entry.isFile() && entry.name === "SKILL.md") && classify(skillPath)?.kind === "skill";

    for (const entry of entries) {
      const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORED_DIRECTORIES.has(entry.name)) continue;
        if (isSkillDirectory && SKILL_RESOURCE_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        if (isIgnored(relativePath, true, ignoreRules)) continue;
        await walk(path.join(directory, entry.name), relativePath);
        continue;
      }
      if (!entry.isFile() || isIgnored(relativePath, false, ignoreRules)) continue;

      const metadata = classify(relativePath);
      if (metadata) found.push({ path: normalize(relativePath), absolutePath: path.join(root, relativePath), ...metadata });
    }
  }

  await walk(root);
  return found;
}
