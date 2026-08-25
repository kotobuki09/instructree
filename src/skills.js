import fs from "node:fs/promises";
import path from "node:path";
import { CODEX_SKILL_UTF8_BOM_MESSAGE, parseFrontmatter } from "./frontmatter.js";

const CODEX_UNKNOWN_CONTEXT_WINDOW_REFERENCE_CHARS = 8000;
const CODEX_MAX_SCAN_DEPTH = 6;
const CODEX_SKILLS_SOURCE = "https://developers.openai.com/codex/skills";

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

async function hasEntry(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function findRepositoryRoot(start) {
  let current = start;
  while (true) {
    if (await hasEntry(path.join(current, ".git"))) return { root: current, markerFound: true };
    const parent = path.dirname(current);
    if (parent === current) return { root: start, markerFound: false };
    current = parent;
  }
}

function displaySkillPath(scope, relativePath) {
  if (scope.kind === "user") return `~/.agents/skills/${relativePath}`;
  return normalize(path.relative(scope.repositoryRoot, path.join(scope.absoluteRoot, relativePath)));
}

function scopePath(scope) {
  if (scope.kind === "user") return "~/.agents/skills";
  const relative = normalize(path.relative(scope.repositoryRoot, scope.absoluteRoot));
  return relative || ".agents/skills";
}

function scopeDirectory(scope) {
  if (scope.kind === "user") return null;
  const relative = normalize(path.relative(scope.repositoryRoot, scope.absoluteDirectory));
  return relative || ".";
}

function textValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataReport(scope, relativePath, content) {
  const parsed = parseFrontmatter(content);
  const name = textValue(parsed.data.name);
  const description = textValue(parsed.data.description);
  const failures = [];
  if (parsed.present && parsed.utf8Bom) {
    failures.push({
      code: "unsupported-utf8-bom",
      field: "frontmatter",
      line: 1,
      message: CODEX_SKILL_UTF8_BOM_MESSAGE,
    });
  }
  failures.push(...parsed.errors.map((error) => ({
    code: "malformed-frontmatter",
    field: null,
    line: error.line,
    message: error.message,
  })));

  if (!parsed.present) {
    failures.push({
      code: "missing-frontmatter",
      field: "frontmatter",
      line: 1,
      message: "skill files require YAML frontmatter",
    });
  }
  for (const field of ["name", "description"]) {
    if (!textValue(parsed.data[field])) {
      failures.push({
        code: `missing-${field}`,
        field,
        line: parsed.keyLines[field] ?? 1,
        message: `missing required frontmatter field '${field}'`,
      });
    }
  }
  if (name && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    failures.push({
      code: "invalid-name",
      field: "name",
      line: parsed.keyLines.name ?? 1,
      message: "skill name must use lower-case kebab-case",
    });
  }

  const folderName = path.posix.basename(path.posix.dirname(normalize(relativePath)));
  const warnings = [];
  if (name && name !== folderName) {
    warnings.push({
      code: "mismatched-folder-name",
      field: "name",
      line: parsed.keyLines.name ?? 1,
      message: `skill name '${name}' does not match its folder '${folderName}'`,
    });
  }

  const displayPath = displaySkillPath(scope, relativePath);
  return {
    path: displayPath,
    name,
    description,
    metadata: {
      valid: failures.length === 0,
      failures,
      warnings,
      nameLine: parsed.keyLines.name ?? null,
    },
  };
}

function logicalScanPath(scope, relativePath = "") {
  return relativePath ? displaySkillPath(scope, relativePath) : scopePath(scope);
}

async function discoverScope(scope, seenCanonicalSkillTargets) {
  const skills = [];
  const errors = [];
  let exists = false;
  let isDirectory = false;

  try {
    await fs.lstat(scope.absoluteRoot);
    exists = true;
  } catch (error) {
    if (error.code === "ENOENT") return { exists, isDirectory, skills, errors };
    errors.push({
      code: "scope-read-failure",
      path: scopePath(scope),
      line: 1,
      message: `could not inspect skill scope: ${error.code ?? "error"}`,
    });
    return { exists, isDirectory, skills, errors };
  }

  try {
    isDirectory = (await fs.stat(scope.absoluteRoot)).isDirectory();
  } catch (error) {
    errors.push({
      code: "scope-read-failure",
      path: scopePath(scope),
      line: 1,
      message: `could not inspect skill scope: ${error.code ?? "error"}`,
    });
    return { exists, isDirectory, skills, errors };
  }

  if (!isDirectory) {
    errors.push({
      code: "scope-not-directory",
      path: scopePath(scope),
      line: 1,
      message: "skill scope exists but is not a directory",
    });
    return { exists, isDirectory, skills, errors };
  }

  const addError = (relativePath, message, code = "scan-failure") => {
    errors.push({ code, path: logicalScanPath(scope, relativePath), line: 1, message });
  };

  const readSkill = async (skillFile, relativePath) => {
    let canonicalSkillFile;
    try {
      canonicalSkillFile = await fs.realpath(skillFile);
    } catch (error) {
      if (error.code !== "ENOENT") addError(relativePath, `could not resolve skill metadata: ${error.code ?? "error"}`);
      return;
    }
    if (seenCanonicalSkillTargets.has(canonicalSkillFile)) return;
    seenCanonicalSkillTargets.add(canonicalSkillFile);

    try {
      const content = await fs.readFile(skillFile, "utf8");
      skills.push({
        ...metadataReport(scope, relativePath, content),
        scope: scope.kind,
        scopeDirectory: scopeDirectory(scope),
        scopePath: scopePath(scope),
        order: scope.order,
      });
    } catch (error) {
      addError(relativePath, `could not read skill metadata: ${error.code ?? "error"}`);
    }
  };

  const walk = async (directory, relativeDirectory, ancestors) => {
    let canonicalDirectory;
    try {
      canonicalDirectory = await fs.realpath(directory);
    } catch (error) {
      addError(relativeDirectory, `could not resolve skill directory: ${error.code ?? "error"}`);
      return;
    }
    if (ancestors.has(canonicalDirectory)) {
      addError(relativeDirectory, "directory cycle detected; skipped recursive scan", "scan-cycle");
      return;
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(canonicalDirectory);

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      addError(relativeDirectory, `could not read skill directory: ${error.code ?? "error"}`);
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const relativeEntry = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const relativeParts = relativeEntry.split("/");
      if (entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink())) continue;

      const absoluteEntry = path.join(directory, entry.name);
      let entryStat;
      try {
        entryStat = await fs.stat(absoluteEntry);
      } catch (error) {
        if (error.code !== "ENOENT") addError(relativeEntry, `could not inspect skill entry: ${error.code ?? "error"}`);
        continue;
      }

      if (entryStat.isDirectory()) {
        if (relativeParts.length <= CODEX_MAX_SCAN_DEPTH - 1) {
          await walk(absoluteEntry, relativeEntry, nextAncestors);
        }
        continue;
      }
      if (entry.name === "SKILL.md" && entryStat.isFile() && relativeParts.length <= CODEX_MAX_SCAN_DEPTH) {
        await readSkill(absoluteEntry, relativeEntry);
      }
    }
  };

  await walk(scope.absoluteRoot, "", new Set());

  skills.sort((left, right) => left.path.localeCompare(right.path));
  errors.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message));
  return { exists, isDirectory, skills, errors };
}

function listingEstimate(skill) {
  const nameChars = Array.from(skill.name ?? "(unnamed)").length;
  const descriptionChars = Array.from(skill.description ?? "").length;
  const pathChars = Array.from(skill.path).length;
  const separatorChars = 3;
  return {
    nameChars,
    descriptionChars,
    pathChars,
    separatorChars,
    totalChars: nameChars + descriptionChars + pathChars + separatorChars,
  };
}

function duplicateReports(skills) {
  const byName = new Map();
  for (const skill of skills) {
    if (!skill.name) continue;
    if (!byName.has(skill.name)) byName.set(skill.name, []);
    byName.get(skill.name).push({
      scope: skill.scope,
      scopeDirectory: skill.scopeDirectory,
      path: skill.path,
      line: skill.metadata.nameLine,
    });
  }
  return [...byName.entries()]
    .filter(([, occurrences]) => occurrences.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, occurrences]) => ({
      name,
      crossScope: new Set(occurrences.map((item) => `${item.scope}:${item.scopeDirectory ?? ""}`)).size > 1,
      occurrences,
      message: `possible duplicate skill name '${name}' across Codex skill scopes`,
    }));
}

function withoutOrder(skill) {
  const { order, ...publicSkill } = skill;
  return publicSkill;
}

export async function auditCodexSkills(cwd = process.cwd(), home = process.env.HOME ?? process.env.USERPROFILE) {
  const absoluteCwd = await fs.realpath(path.resolve(cwd));
  const cwdStat = await fs.stat(absoluteCwd);
  if (!cwdStat.isDirectory()) throw new Error(`not a directory: ${absoluteCwd}`);

  const repository = await findRepositoryRoot(absoluteCwd);
  const repositoryRoot = repository.root;
  const repositoryDirectories = [];
  let current = absoluteCwd;
  while (true) {
    repositoryDirectories.push(current);
    if (current === repositoryRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const scopes = [];
  if (home) {
    scopes.push({
      kind: "user",
      order: 0,
      absoluteRoot: path.join(path.resolve(home), ".agents", "skills"),
      absoluteDirectory: null,
      repositoryRoot,
    });
  }
  repositoryDirectories.forEach((absoluteDirectory, index) => {
    scopes.push({
      kind: "repository",
      order: index + 1,
      absoluteRoot: path.join(absoluteDirectory, ".agents", "skills"),
      absoluteDirectory,
      repositoryRoot,
    });
  });

  const scannedScopes = [];
  const allSkills = [];
  const scanErrors = [];
  const seenCanonicalSkillTargets = new Set();
  for (const scope of scopes) {
    const result = await discoverScope(scope, seenCanonicalSkillTargets);
    const publicSkills = result.skills.map(withoutOrder);
    scannedScopes.push({
      scope: scope.kind,
      directory: scopeDirectory(scope),
      path: scopePath(scope),
      candidate: true,
      exists: result.exists,
      isDirectory: result.isDirectory,
      skillCount: publicSkills.length,
      scanErrorCount: result.errors.length,
      skills: publicSkills,
    });
    allSkills.push(...result.skills);
    scanErrors.push(...result.errors);
  }
  allSkills.sort((left, right) => left.order - right.order || left.path.localeCompare(right.path));

  const metadataFailures = allSkills
    .flatMap((skill) => skill.metadata.failures.map((failure) => ({
      ...failure,
      path: skill.path,
      scope: skill.scope,
      scopeDirectory: skill.scopeDirectory,
    })))
    .sort((left, right) => left.path.localeCompare(right.path) || String(left.field).localeCompare(String(right.field)) || left.code.localeCompare(right.code));
  const metadataWarnings = allSkills
    .flatMap((skill) => skill.metadata.warnings.map((warning) => ({
      ...warning,
      path: skill.path,
      scope: skill.scope,
      scopeDirectory: skill.scopeDirectory,
    })))
    .sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
  const duplicates = duplicateReports(allSkills);
  const estimates = allSkills.map(listingEstimate);
  const estimateTotals = estimates.reduce(
    (totals, estimate) => {
      totals.initialList += estimate.totalChars;
      totals.names += estimate.nameChars;
      totals.descriptions += estimate.descriptionChars;
      totals.paths += estimate.pathChars;
      totals.separators += estimate.separatorChars;
      return totals;
    },
    { initialList: 0, names: 0, descriptions: 0, paths: 0, separators: 0 },
  );
  const pressure = {
    estimatedInitialListChars: estimateTotals.initialList,
    estimatedNameChars: estimateTotals.names,
    estimatedDescriptionChars: estimateTotals.descriptions,
    estimatedPathChars: estimateTotals.paths,
    separatorChars: estimateTotals.separators,
    unknownContextWindowReferenceChars: CODEX_UNKNOWN_CONTEXT_WINDOW_REFERENCE_CHARS,
    remainingAgainstUnknownContextWindowReferenceChars: Math.max(
      0,
      CODEX_UNKNOWN_CONTEXT_WINDOW_REFERENCE_CHARS - estimateTotals.initialList,
    ),
    status:
      estimateTotals.initialList > CODEX_UNKNOWN_CONTEXT_WINDOW_REFERENCE_CHARS
        ? "exceeds-unknown-window-reference"
        : "within-unknown-window-reference",
    note: "Approximate only: Codex uses at most 2% of the model context, or 8,000 characters when the context window is unknown; logical redacted paths may differ from runtime paths.",
  };

  return {
    client: "codex",
    profile: "codex-local-skill-scopes",
    repository: {
      root: "<repository>",
      currentDirectory: normalize(path.relative(repositoryRoot, absoluteCwd)) || ".",
      repositoryMarkerFound: repository.markerFound,
    },
    scopes: scannedScopes,
    skills: allSkills.map(withoutOrder),
    duplicates,
    metadataFailures,
    metadataWarnings,
    pressure,
    signals: {
      duplicateCount: duplicates.length,
      crossScopeDuplicateCount: duplicates.filter((item) => item.crossScope).length,
      metadataFailureCount: metadataFailures.length,
      metadataWarningCount: metadataWarnings.length,
      scanErrorCount: scanErrors.length,
    },
    scanErrors,
    provenance: {
      source: CODEX_SKILLS_SOURCE,
      scopeModel: "user ~/.agents/skills plus .agents/skills from the current directory to the repository root",
      limitations: [
        "Does not include Codex admin or system skills.",
        "Does not read ~/.codex/config.toml, so local skill enable or disable state is unknown.",
        "Uses the nearest .git marker rather than configured Codex project-root markers.",
        "Reports candidate discovery paths, not the exact skills loaded for a run.",
      ],
    },
  };
}
