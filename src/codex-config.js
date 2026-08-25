import fs from "node:fs/promises";
import path from "node:path";

const CONFIG_DISPLAY_PATH = "~/.codex/config.toml";
const DEFAULT_PROJECT_DOC_MAX_BYTES = 32 * 1024;
const DEFAULT_PROJECT_ROOT_MARKERS = [".git"];

function stripComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === "'") quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "#") return line.slice(0, index);
  }
  return line;
}

function parseString(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? { supported: true, value: parsed } : { supported: false };
    } catch {
      return { supported: false };
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && !value.slice(1, -1).includes("'")) {
    return { supported: true, value: value.slice(1, -1) };
  }
  return { supported: false };
}

function parseBoolean(value) {
  if (value === "true") return { supported: true, value: true };
  if (value === "false") return { supported: true, value: false };
  return { supported: false };
}

function parsePositiveInteger(value) {
  if (!/^[1-9]\d*$/.test(value)) return { supported: false };
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? { supported: true, value: parsed } : { supported: false };
}

function parseNonNegativeInteger(value) {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return { supported: false };
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? { supported: true, value: parsed } : { supported: false };
}

function parseStringArray(value) {
  if (!value.startsWith("[") || !value.endsWith("]")) return { supported: false };
  const body = value.slice(1, -1).trim();
  if (!body) return { supported: true, value: [] };

  const values = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index <= body.length; index += 1) {
    const character = body[index];
    if (index < body.length && quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = null;
      continue;
    }
    if (index < body.length && quote === "'") {
      if (character === "'") quote = null;
      continue;
    }
    if (index < body.length && (character === '"' || character === "'")) {
      quote = character;
      continue;
    }
    if (index < body.length && character !== ",") continue;
    const item = body.slice(start, index).trim();
    if (!item) {
      if (index === body.length && body.endsWith(",")) break;
      return { supported: false };
    }
    const parsed = parseString(item);
    if (!parsed.supported) return { supported: false };
    values.push(parsed.value);
    start = index + 1;
  }
  if (quote) return { supported: false };
  return { supported: true, value: values };
}

function portableFilename(value) {
  return value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes(":") &&
    !value.includes("\0");
}

export function parseCodexProjectConfig(content) {
  const settings = {
    maxBytes: DEFAULT_PROJECT_DOC_MAX_BYTES,
    fallbackFilenames: [],
    rootMarkers: [...DEFAULT_PROJECT_ROOT_MARKERS],
  };
  const sources = {
    maxBytes: "default",
    fallbackFilenames: "default",
    rootMarkers: "default",
  };
  const issues = [];
  const seen = new Set();
  const settingLines = {};
  let unsupported = false;
  let topLevel = true;

  const addIssue = (code, line, message) => {
    issues.push({ code, path: CONFIG_DISPLAY_PATH, line, message });
    unsupported = true;
  };

  if (content.startsWith("\uFEFF")) {
    addIssue("unsupported-utf8-bom", 1, "UTF-8 BOM before Codex configuration is unsupported by this audit");
  }

  const fields = {
    project_doc_max_bytes: ["maxBytes", parseNonNegativeInteger],
    project_doc_fallback_filenames: ["fallbackFilenames", parseStringArray],
    project_root_markers: ["rootMarkers", parseStringArray],
  };
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const stripped = stripComment(lines[index]).trim();
    if (!stripped) continue;
    if (stripped.startsWith("[")) {
      topLevel = false;
      continue;
    }
    const assignment = stripped.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    const [, key, rawValue] = assignment;
    if (!Object.hasOwn(fields, key)) continue;
    if (!topLevel) {
      addIssue("misplaced-setting", lineNumber, `Codex project setting '${key}' must be top-level`);
      continue;
    }
    if (seen.has(key)) {
      addIssue("duplicate-setting", lineNumber, `duplicate Codex project setting '${key}'`);
      continue;
    }
    seen.add(key);
    const [field, parser] = fields[key];
    settingLines[field] = lineNumber;
    const parsed = parser(rawValue);
    if (!parsed.supported) {
      addIssue("unsupported-value", lineNumber, `unsupported value for Codex project setting '${key}'`);
      continue;
    }
    settings[field] = parsed.value;
    sources[field] = "user";
  }

  const fallbacks = [];
  for (const fallback of settings.fallbackFilenames) {
    if (!fallback) continue;
    if (!portableFilename(fallback)) {
      addIssue("invalid-fallback", settingLines.fallbackFilenames ?? 1, `project fallback must be a repository-local filename: ${fallback}`);
      continue;
    }
    if (!["AGENTS.override.md", "AGENTS.md", ...fallbacks].includes(fallback)) fallbacks.push(fallback);
  }
  settings.fallbackFilenames = fallbacks;

  if (settings.rootMarkers.some((marker) => !marker || path.isAbsolute(marker) || marker.split(/[\\/]/).includes(".."))) {
    addIssue("invalid-root-marker", settingLines.rootMarkers ?? 1, "project root markers must be non-empty repository-relative paths");
  }

  return {
    status: unsupported ? "unsupported" : "parsed",
    settings: unsupported ? { maxBytes: null, fallbackFilenames: null, rootMarkers: null } : settings,
    sources,
    issues,
  };
}

function samePath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function canonicalPath(value) {
  try {
    return await fs.realpath(value);
  } catch {
    return path.resolve(value);
  }
}

export function parseCodexSkillsConfig(content) {
  const settings = {
    includeInstructions: null,
    maxContextTokens: null,
    bundledEnabled: null,
  };
  const rules = [];
  const issues = [];
  const seenSettings = new Set();
  let unsupported = false;
  let section = "other";
  let entry = null;

  const addIssue = (code, line, message, fatal = false) => {
    issues.push({ code, path: CONFIG_DISPLAY_PATH, line, message });
    if (fatal) unsupported = true;
  };

  const finalizeEntry = () => {
    if (!entry) return;
    const selectorCount = Number(Object.hasOwn(entry.values, "name")) + Number(Object.hasOwn(entry.values, "path"));
    if (!Object.hasOwn(entry.values, "enabled")) {
      addIssue("missing-enabled", entry.line, "skills.config entry is missing required boolean 'enabled'", true);
    } else if (selectorCount !== 1) {
      addIssue(
        "invalid-selector",
        entry.line,
        selectorCount === 0
          ? "skills.config entry requires exactly one 'name' or 'path' selector"
          : "skills.config entry cannot contain both 'name' and 'path' selectors",
      );
    } else if (Object.hasOwn(entry.values, "name") && entry.values.name.trim() === "") {
      addIssue("blank-selector", entry.lines.name, "skills.config name selector is blank and Codex ignores it");
    } else if (Object.hasOwn(entry.values, "path") && !path.isAbsolute(entry.values.path)) {
      addIssue("non-absolute-path", entry.lines.path, "skills.config path selector must be absolute", true);
    } else {
      const selector = Object.hasOwn(entry.values, "name") ? "name" : "path";
      rules.push({
        selector,
        value: selector === "name" ? entry.values.name.trim() : entry.values.path,
        enabled: entry.values.enabled,
        line: entry.lines[selector] ?? entry.line,
      });
    }
    entry = null;
  };

  if (content.startsWith("\uFEFF")) {
    addIssue("unsupported-utf8-bom", 1, "UTF-8 BOM before Codex configuration is unsupported by this audit", true);
  }

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const stripped = stripComment(lines[index]).trim();
    if (!stripped) continue;

    const arrayTable = stripped.match(/^\[\[\s*([A-Za-z0-9_.-]+)\s*\]\]$/);
    const table = stripped.match(/^\[\s*([A-Za-z0-9_.-]+)\s*\]$/);
    if (arrayTable || table) {
      finalizeEntry();
      const tableName = (arrayTable ?? table)[1];
      if (arrayTable && tableName === "skills.config") {
        section = "config";
        entry = { line: lineNumber, values: {}, lines: {} };
      } else if (!arrayTable && tableName === "skills") section = "skills";
      else if (!arrayTable && tableName === "skills.bundled") section = "bundled";
      else {
        section = "other";
        if (tableName === "skills.config" || tableName.startsWith("skills.")) {
          addIssue("unsupported-table", lineNumber, `unsupported Codex skill table '${tableName}'`, true);
        }
      }
      continue;
    }
    if (stripped.startsWith("[") && stripped.includes("skills")) {
      finalizeEntry();
      section = "other";
      addIssue("unsupported-table", lineNumber, "unsupported Codex skill table syntax", true);
      continue;
    }

    if (!["skills", "bundled", "config"].includes(section)) {
      if (/^skills(?:\.|\s*=)/.test(stripped)) {
        addIssue("unsupported-syntax", lineNumber, "unsupported inline or dotted Codex skill configuration", true);
      }
      continue;
    }
    const assignment = stripped.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) {
      addIssue("unsupported-syntax", lineNumber, "unsupported syntax in Codex skill configuration", true);
      continue;
    }
    const [, key, rawValue] = assignment;

    if (section === "config") {
      if (!entry) entry = { line: lineNumber, values: {}, lines: {} };
      if (!["name", "path", "enabled"].includes(key)) {
        addIssue("unknown-setting", lineNumber, `unknown skills.config setting '${key}'`, true);
        continue;
      }
      if (Object.hasOwn(entry.values, key)) {
        addIssue("duplicate-setting", lineNumber, `duplicate skills.config setting '${key}'`, true);
        continue;
      }
      const parsed = key === "enabled" ? parseBoolean(rawValue) : parseString(rawValue);
      if (!parsed.supported) {
        addIssue("unsupported-value", lineNumber, `unsupported value for skills.config '${key}'`, true);
        continue;
      }
      entry.values[key] = parsed.value;
      entry.lines[key] = lineNumber;
      continue;
    }

    if (section === "skills") {
      const field = {
        include_instructions: ["includeInstructions", parseBoolean],
        max_context_tokens: ["maxContextTokens", parsePositiveInteger],
      }[key];
      if (!field) {
        addIssue("unknown-setting", lineNumber, `unknown skills setting '${key}'`, true);
        continue;
      }
      const settingKey = `skills.${key}`;
      if (seenSettings.has(settingKey)) {
        addIssue("duplicate-setting", lineNumber, `duplicate skills setting '${key}'`, true);
        continue;
      }
      seenSettings.add(settingKey);
      const parsed = field[1](rawValue);
      if (!parsed.supported) {
        addIssue("unsupported-value", lineNumber, `unsupported value for skills '${key}'`, true);
        continue;
      }
      settings[field[0]] = parsed.value;
      continue;
    }

    if (key !== "enabled") {
      addIssue("unknown-setting", lineNumber, `unknown skills.bundled setting '${key}'`, true);
      continue;
    }
    if (seenSettings.has("skills.bundled.enabled")) {
      addIssue("duplicate-setting", lineNumber, "duplicate skills.bundled setting 'enabled'", true);
      continue;
    }
    seenSettings.add("skills.bundled.enabled");
    const parsed = parseBoolean(rawValue);
    if (!parsed.supported) {
      addIssue("unsupported-value", lineNumber, "unsupported value for skills.bundled 'enabled'", true);
      continue;
    }
    settings.bundledEnabled = parsed.value;
  }
  finalizeEntry();
  return { status: unsupported ? "unsupported" : "parsed", settings, rules, issues };
}

function emptyConfiguration(status, exists, issues = []) {
  return {
    path: CONFIG_DISPLAY_PATH,
    exists,
    status,
    settings: {
      includeInstructions: null,
      maxContextTokens: null,
      bundledEnabled: null,
    },
    effectiveRules: [],
    effectiveRuleCount: 0,
    matchedRuleCount: 0,
    unmatchedRuleCount: 0,
    unmatchedRules: [],
    disabledSkills: [],
    issues,
  };
}

export async function resolveCodexProjectConfig(home) {
  const defaults = {
    maxBytes: DEFAULT_PROJECT_DOC_MAX_BYTES,
    fallbackFilenames: [],
    rootMarkers: [...DEFAULT_PROJECT_ROOT_MARKERS],
  };
  const defaultSources = {
    maxBytes: "default",
    fallbackFilenames: "default",
    rootMarkers: "default",
  };
  if (!home) {
    return {
      path: CONFIG_DISPLAY_PATH,
      exists: false,
      status: "unavailable",
      settings: { maxBytes: null, fallbackFilenames: null, rootMarkers: null },
      sources: defaultSources,
      issues: [],
    };
  }

  const configPath = path.join(path.resolve(home), ".codex", "config.toml");
  let content;
  try {
    content = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        path: CONFIG_DISPLAY_PATH,
        exists: false,
        status: "missing",
        settings: defaults,
        sources: defaultSources,
        issues: [],
      };
    }
    return {
      path: CONFIG_DISPLAY_PATH,
      exists: true,
      status: "unreadable",
      settings: { maxBytes: null, fallbackFilenames: null, rootMarkers: null },
      sources: defaultSources,
      issues: [{
        code: "config-read-failure",
        path: CONFIG_DISPLAY_PATH,
        line: 1,
        message: `could not read Codex user config: ${error.code ?? "error"}`,
      }],
    };
  }

  return {
    path: CONFIG_DISPLAY_PATH,
    exists: true,
    ...parseCodexProjectConfig(content),
  };
}

export async function resolveCodexSkillsConfig(home, skills) {
  if (!home) return { configuration: emptyConfiguration("unavailable", false), enabledByPath: new Map() };
  const configPath = path.join(path.resolve(home), ".codex", "config.toml");
  let content;
  try {
    content = await fs.readFile(configPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { configuration: emptyConfiguration("missing", false), enabledByPath: new Map() };
    const issue = {
      code: "config-read-failure",
      path: CONFIG_DISPLAY_PATH,
      line: 1,
      message: `could not read Codex user config: ${error.code ?? "error"}`,
    };
    return { configuration: emptyConfiguration("unreadable", true, [issue]), enabledByPath: new Map() };
  }

  const parsed = parseCodexSkillsConfig(content);
  if (parsed.status !== "parsed") {
    const configuration = emptyConfiguration(parsed.status, true, parsed.issues);
    return { configuration, enabledByPath: new Map() };
  }

  const preparedRules = [];
  for (const rule of parsed.rules) {
    const comparisonValue = rule.selector === "path" ? await canonicalPath(rule.value) : rule.value;
    const key = `${rule.selector}:${process.platform === "win32" && rule.selector === "path" ? comparisonValue.toLowerCase() : comparisonValue}`;
    const existing = preparedRules.findIndex((item) => item.key === key);
    if (existing !== -1) preparedRules.splice(existing, 1);
    preparedRules.push({ ...rule, comparisonValue, key });
  }

  const enabledByPath = new Map(skills.map((skill) => [skill.absolutePath, true]));
  const effectiveRules = [];
  for (const rule of preparedRules) {
    const matches = skills.filter((skill) =>
      rule.selector === "name"
        ? skill.name === rule.comparisonValue
        : samePath(skill.absolutePath, rule.comparisonValue),
    );
    for (const skill of matches) enabledByPath.set(skill.absolutePath, rule.enabled);
    effectiveRules.push({
      selector: rule.selector,
      value: rule.selector === "name" ? rule.value : "<redacted-path>",
      enabled: rule.enabled,
      line: rule.line,
      matchCount: matches.length,
      matches: matches.map((skill) => skill.path),
    });
  }

  const unmatchedRules = effectiveRules.filter((rule) => rule.matchCount === 0);
  const disabledSkills = skills
    .filter((skill) => enabledByPath.get(skill.absolutePath) === false)
    .map((skill) => ({ name: skill.name, path: skill.path, scope: skill.scope }));
  return {
    enabledByPath,
    configuration: {
      path: CONFIG_DISPLAY_PATH,
      exists: true,
      status: "parsed",
      settings: parsed.settings,
      effectiveRules,
      effectiveRuleCount: effectiveRules.length,
      matchedRuleCount: effectiveRules.filter((rule) => rule.matchCount > 0).length,
      unmatchedRuleCount: unmatchedRules.length,
      unmatchedRules,
      disabledSkills,
      issues: parsed.issues,
    },
  };
}
