import fs from "node:fs/promises";
import path from "node:path";
import { resolveCodexSkillsConfig } from "./codex-config.js";
import { CODEX_SKILL_UTF8_BOM_MESSAGE, parseFrontmatter } from "./frontmatter.js";

const CODEX_UNKNOWN_CONTEXT_WINDOW_REFERENCE_CHARS = 8000;
const CODEX_MAX_SCAN_DEPTH = 6;
const CODEX_MAX_CATALOG_DESCRIPTION_CHARS = 1024;
const CODEX_CATALOG_DESCRIPTION_SUFFIX = "...";
const TOP_PRESSURE_CONTRIBUTOR_LIMIT = 5;
const CODEX_SKILLS_SOURCE = "https://developers.openai.com/codex/skills";
const CODEX_SKILLS_IMPLEMENTATION_SOURCE = "https://github.com/openai/codex/blob/75cb7c903d474b6637a6e9fe6f76cedf76ef1472/codex-rs/ext/skills/src/host_roots.rs#L80-L112";
const CODEX_SKILLS_RENDER_SOURCE = "https://github.com/openai/codex/blob/9b4a0f8a0a60349ecfcc3c32d1dd050ce2efc253/codex-rs/ext/skills/src/render.rs";

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

export async function findCodexProjectRoot(start, markers = [".git"]) {
  if (!Array.isArray(markers)) throw new Error("Codex project root markers must be an array");
  if (markers.length === 0) return { root: start, markerFound: false, marker: null };
  let current = start;
  while (true) {
    for (const marker of markers) {
      if (await hasEntry(path.join(current, marker))) return { root: current, markerFound: true, marker };
    }
    const parent = path.dirname(current);
    if (parent === current) return { root: start, markerFound: false, marker: null };
    current = parent;
  }
}

function displaySkillPath(scope, relativePath) {
  if (scope.kind === "user") return `${scope.displayRoot}/${relativePath}`;
  return normalize(path.relative(scope.repositoryRoot, path.join(scope.absoluteRoot, relativePath)));
}

function scopePath(scope) {
  if (scope.kind === "user") return scope.displayRoot;
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
        absolutePath: canonicalSkillFile,
        symlinked: path.resolve(skillFile) !== canonicalSkillFile,
        scope: scope.kind,
        scopeVariant: scope.variant ?? null,
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

function cappedCatalogDescription(description) {
  const characters = Array.from(description ?? "");
  if (characters.length <= CODEX_MAX_CATALOG_DESCRIPTION_CHARS) {
    return { text: characters.join(""), chars: characters.length, truncated: false };
  }
  const suffixChars = Array.from(CODEX_CATALOG_DESCRIPTION_SUFFIX).length;
  const prefix = characters.slice(0, CODEX_MAX_CATALOG_DESCRIPTION_CHARS - suffixChars).join("");
  return {
    text: `${prefix}${CODEX_CATALOG_DESCRIPTION_SUFFIX}`,
    chars: CODEX_MAX_CATALOG_DESCRIPTION_CHARS,
    truncated: true,
  };
}

function listingEstimate(skill) {
  const name = skill.name ?? "(unnamed)";
  const description = cappedCatalogDescription(skill.description ?? "");
  const line = description.text
    ? `- ${name}: ${description.text} (file: ${skill.path})\n`
    : `- ${name}: (file: ${skill.path})\n`;
  const nameChars = Array.from(name).length;
  const descriptionChars = description.chars;
  const pathChars = Array.from(skill.path).length;
  const totalChars = Array.from(line).length;
  const separatorChars = totalChars - nameChars - descriptionChars - pathChars;
  return {
    nameChars,
    descriptionChars,
    pathChars,
    separatorChars,
    totalChars,
    descriptionTruncated: description.truncated,
  };
}

function topPressureContributors(skills) {
  return skills
    .map((skill) => ({ skill, estimate: listingEstimate(skill) }))
    .sort((left, right) => right.estimate.totalChars - left.estimate.totalChars || left.skill.path.localeCompare(right.skill.path))
    .slice(0, TOP_PRESSURE_CONTRIBUTOR_LIMIT)
    .map(({ skill, estimate }) => ({
      name: skill.name ?? "(unnamed)",
      path: skill.path,
      totalChars: estimate.totalChars,
      descriptionChars: estimate.descriptionChars,
      descriptionTruncated: estimate.descriptionTruncated,
    }));
}

function duplicateReports(skills) {
  const byName = new Map();
  for (const skill of skills) {
    if (!skill.name) continue;
    if (!byName.has(skill.name)) byName.set(skill.name, []);
    byName.get(skill.name).push({
      scope: skill.scope,
      scopeVariant: skill.scopeVariant,
      scopePath: skill.scopePath,
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
      crossScope: new Set(occurrences.map((item) => `${item.scope}:${item.scopePath}:${item.scopeDirectory ?? ""}`)).size > 1,
      occurrences,
      message: `possible duplicate skill name '${name}' across Codex skill scopes`,
    }));
}

function withoutOrder(skill) {
  const { absolutePath, order, ...publicSkill } = skill;
  return publicSkill;
}

export async function auditCodexSkills(
  cwd = process.cwd(),
  home = process.env.HOME ?? process.env.USERPROFILE,
  options = {},
) {
  const absoluteCwd = await fs.realpath(path.resolve(cwd));
  const cwdStat = await fs.stat(absoluteCwd);
  if (!cwdStat.isDirectory()) throw new Error(`not a directory: ${absoluteCwd}`);

  const projectRootMarkers = options.projectRootMarkers ?? [".git"];
  const repository = await findCodexProjectRoot(absoluteCwd, projectRootMarkers);
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
    const absoluteHome = path.resolve(home);
    scopes.push({
      kind: "user",
      variant: "shared",
      displayRoot: "~/.agents/skills",
      order: 0,
      absoluteRoot: path.join(absoluteHome, ".agents", "skills"),
      absoluteDirectory: null,
      repositoryRoot,
    });
    scopes.push({
      kind: "user",
      variant: "legacy",
      displayRoot: "~/.codex/skills",
      order: 1,
      absoluteRoot: path.join(absoluteHome, ".codex", "skills"),
      absoluteDirectory: null,
      repositoryRoot,
    });
  }
  repositoryDirectories.forEach((absoluteDirectory, index) => {
    scopes.push({
      kind: "repository",
      order: index + 2,
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
      variant: scope.variant ?? null,
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
  const sharedUserNames = new Set(
    allSkills
      .filter((skill) => skill.scope === "user" && skill.scopeVariant === "shared" && skill.name)
      .map((skill) => skill.name),
  );
  for (const skill of allSkills) {
    skill.legacyOnlyUserRoot = skill.scope === "user"
      && skill.scopeVariant === "legacy"
      && Boolean(skill.name)
      && !sharedUserNames.has(skill.name);
  }
  const { configuration, enabledByPath } = await resolveCodexSkillsConfig(home, allSkills);
  for (const skill of allSkills) {
    skill.configuredEnabled = enabledByPath.get(skill.absolutePath) ?? true;
  }
  const configuredByPath = new Map(allSkills.map((skill) => [skill.path, skill.configuredEnabled]));
  const legacyOnlyByPath = new Map(allSkills.map((skill) => [skill.path, skill.legacyOnlyUserRoot]));
  for (const scope of scannedScopes) {
    scope.skills = scope.skills.map((skill) => ({
      ...skill,
      configuredEnabled: configuredByPath.get(skill.path) ?? true,
      legacyOnlyUserRoot: legacyOnlyByPath.get(skill.path) ?? false,
    }));
  }

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
  const configuredSkills = configuration.settings.includeInstructions === false
    ? []
    : allSkills.filter((skill) => skill.configuredEnabled);
  const configuredEstimates = configuredSkills.map(listingEstimate);
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
  const configuredInitialList = configuredEstimates.reduce((total, estimate) => total + estimate.totalChars, 0);
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
    configuredCandidateCount: configuredSkills.length,
    configuredEstimatedInitialListChars: configuredInitialList,
    configuredStatus:
      configuration.settings.includeInstructions === false
        ? "catalog-disabled-by-user-config"
        : configuredInitialList > CODEX_UNKNOWN_CONTEXT_WINDOW_REFERENCE_CHARS
          ? "exceeds-unknown-window-reference"
          : "within-unknown-window-reference",
    topConfiguredContributors: topPressureContributors(configuredSkills),
    topContributorLimit: TOP_PRESSURE_CONTRIBUTOR_LIMIT,
    estimateModel: "Codex's 8,000-character unknown-context fallback with a 1,024-character per-skill description cap and logical redacted paths; runtime path aliasing and tokenization are not modeled.",
    note: "Approximate only: Codex defaults to 2% of the known model context and may use tokens or path aliases; the configured estimate reflects supported user config only.",
  };

  return {
    client: "codex",
    profile: "codex-local-skill-scopes",
    repository: {
      root: "<repository>",
      currentDirectory: normalize(path.relative(repositoryRoot, absoluteCwd)) || ".",
      repositoryMarkerFound: repository.markerFound,
      marker: repository.marker,
      markers: projectRootMarkers,
      markerSource: options.projectRootMarkerSource ?? "default",
    },
    scopes: scannedScopes,
    skills: allSkills.map(withoutOrder),
    configuration,
    duplicates,
    metadataFailures,
    metadataWarnings,
    pressure,
    signals: {
      duplicateCount: duplicates.length,
      crossScopeDuplicateCount: duplicates.filter((item) => item.crossScope).length,
      symlinkedSkillCount: allSkills.filter((skill) => skill.symlinked).length,
      legacyOnlyUserSkillCount: allSkills.filter((skill) => skill.legacyOnlyUserRoot).length,
      metadataFailureCount: metadataFailures.length,
      metadataWarningCount: metadataWarnings.length,
      scanErrorCount: scanErrors.length,
      disabledByUserConfigCount: configuration.disabledSkills.length,
      unmatchedConfigRuleCount: configuration.unmatchedRuleCount,
      configIssueCount: configuration.issues.length,
    },
    scanErrors,
    provenance: {
      source: CODEX_SKILLS_SOURCE,
      implementationSource: CODEX_SKILLS_IMPLEMENTATION_SOURCE,
      renderSource: CODEX_SKILLS_RENDER_SOURCE,
      scopeModel: "user ~/.agents/skills, deprecated user ~/.codex/skills, plus .agents/skills from the current directory to the repository root",
      limitations: [
        "Does not include Codex admin or system skills.",
        "Audits the default deprecated ~/.codex/skills location; a custom CODEX_HOME is not resolved.",
        "Reads only supported skill settings from user ~/.codex/config.toml; session flags and project config are not applied.",
        options.projectRootMarkers
          ? "Uses supported user project-root markers; managed configuration and session overrides are not applied."
          : "Uses the nearest .git marker rather than configured Codex project-root markers.",
        "Reports user-configured candidate state, not the exact skills loaded after plugins, product restrictions, or session overrides.",
      ],
    },
  };
}
