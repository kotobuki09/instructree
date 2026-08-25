import fs from "node:fs/promises";
import path from "node:path";
import { resolveCodexProjectConfig } from "./codex-config.js";
import { explain } from "./index.js";
import { auditCodexSkills, findCodexProjectRoot } from "./skills.js";

const CODEX_AGENTS_SOURCE = "https://github.com/openai/codex/blob/4213b38f3c555049bf6f494065698a3dfe587c16/codex-rs/core/src/agents_md.rs";
const CODEX_SKILLS_SOURCE = "https://developers.openai.com/codex/skills";

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function parentLabel(distance) {
  return distance === 1 ? "<parent>" : `<parent:${distance}>`;
}

async function inspectEntry(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return null;
    throw error;
  }
}

async function inspectRootBoundary(repository, rootMarkers, fallbackFilenames) {
  const clear = (outerMarker = null, warnings = []) => ({
    status: "clear",
    ignoredInstructionCount: 0,
    ignoredInstructions: [],
    outerMarker,
    warnings,
  });
  if (!repository.markerFound || rootMarkers.length === 0) return clear();

  const filenames = ["AGENTS.override.md", "AGENTS.md", ...fallbackFilenames]
    .filter((filename, index, values) => filename && values.indexOf(filename) === index);
  const possibleInstructions = [];
  const warnings = [];
  let current = path.dirname(repository.root);
  let distance = 1;

  while (true) {
    const displayDirectory = parentLabel(distance);
    for (const filename of filenames) {
      try {
        const metadata = await fs.stat(path.join(current, filename));
        if (!metadata.isFile()) continue;
        possibleInstructions.push({
          path: `${displayDirectory}/${filename}`,
          filename,
          distance,
        });
        break;
      } catch (error) {
        if (["ENOENT", "ENOTDIR"].includes(error.code)) continue;
        warnings.push({
          code: "root-boundary-read-failure",
          path: `${displayDirectory}/${filename}`,
          line: 1,
          message: `could not inspect parent instruction candidate: ${error.code ?? "error"}`,
        });
        break;
      }
    }

    let outerMarker = null;
    for (const marker of rootMarkers) {
      try {
        if (await inspectEntry(path.join(current, marker))) {
          outerMarker = { path: displayDirectory, marker, distance };
          break;
        }
      } catch (error) {
        warnings.push({
          code: "root-boundary-read-failure",
          path: `${displayDirectory}/${marker}`,
          line: 1,
          message: `could not inspect parent project-root marker: ${error.code ?? "error"}`,
        });
      }
    }

    if (outerMarker) {
      return {
        status: possibleInstructions.length > 0 ? "attention" : "clear",
        ignoredInstructionCount: possibleInstructions.length,
        ignoredInstructions: possibleInstructions,
        outerMarker,
        warnings,
      };
    }

    const parent = path.dirname(current);
    if (parent === current) return clear(null, warnings);
    current = parent;
    distance += 1;
  }
}

async function userInstructions(home) {
  if (!home) {
    return { status: "unavailable", selected: null, skippedEmpty: [], warnings: [] };
  }
  const codexHome = path.join(path.resolve(home), ".codex");
  const skippedEmpty = [];
  const warnings = [];
  for (const filename of ["AGENTS.override.md", "AGENTS.md"]) {
    const displayPath = `~/.codex/${filename}`;
    const candidate = path.join(codexHome, filename);
    let metadata;
    try {
      metadata = await fs.stat(candidate);
    } catch (error) {
      if (error.code !== "ENOENT") {
        warnings.push({
          code: "user-instruction-read-failure",
          path: displayPath,
          line: 1,
          message: `could not inspect Codex user instructions: ${error.code ?? "error"}`,
        });
      }
      continue;
    }
    if (!metadata.isFile()) continue;

    let data;
    try {
      data = await fs.readFile(candidate);
    } catch (error) {
      warnings.push({
        code: "user-instruction-read-failure",
        path: displayPath,
        line: 1,
        message: `could not read Codex user instructions: ${error.code ?? "error"}`,
      });
      continue;
    }
    if (!data.toString("utf8").trim()) {
      skippedEmpty.push({ path: displayPath, bytes: data.length });
      continue;
    }
    return {
      status: "selected",
      selected: { path: displayPath, bytes: data.length },
      skippedEmpty,
      warnings,
    };
  }
  return { status: "missing", selected: null, skippedEmpty, warnings };
}

function projectUnavailable(projectConfiguration) {
  return {
    status: "unavailable",
    reason: `user project configuration is ${projectConfiguration.status}`,
    files: [],
    maxBytes: null,
    includedBytes: null,
    truncated: null,
    budgetExhausted: null,
    diagnostics: [],
  };
}

function skillSummary(audit) {
  return {
    candidateCount: audit.skills.length,
    configuredCandidateCount: audit.pressure.configuredCandidateCount,
    disabledByUserConfigCount: audit.configuration.disabledSkills.length,
    disabledSkills: audit.configuration.disabledSkills,
    unmatchedConfigRuleCount: audit.configuration.unmatchedRuleCount,
    unmatchedConfigRules: audit.configuration.unmatchedRules,
    configIssueCount: audit.configuration.issues.length,
    configIssues: audit.configuration.issues,
    duplicateCount: audit.duplicates.length,
    duplicates: audit.duplicates,
    metadataFailureCount: audit.metadataFailures.length,
    metadataFailures: audit.metadataFailures,
    metadataWarningCount: audit.metadataWarnings.length,
    metadataWarnings: audit.metadataWarnings,
    scanErrorCount: audit.scanErrors.length,
    scanErrors: audit.scanErrors,
    pressure: audit.pressure,
  };
}

export async function diagnoseCodex(
  cwd = process.cwd(),
  home = process.env.HOME ?? process.env.USERPROFILE,
) {
  const absoluteCwd = await fs.realpath(path.resolve(cwd));
  if (!(await fs.stat(absoluteCwd)).isDirectory()) throw new Error(`not a directory: ${absoluteCwd}`);

  const projectConfiguration = await resolveCodexProjectConfig(home);
  const usableProjectConfiguration = ["parsed", "missing"].includes(projectConfiguration.status);
  const rootMarkers = usableProjectConfiguration ? projectConfiguration.settings.rootMarkers : [".git"];
  const markerSource = usableProjectConfiguration ? projectConfiguration.sources.rootMarkers : "fallback";
  const repository = await findCodexProjectRoot(absoluteCwd, rootMarkers);
  const boundary = usableProjectConfiguration
    ? await inspectRootBoundary(repository, rootMarkers, projectConfiguration.settings.fallbackFilenames)
    : { status: "unavailable", ignoredInstructionCount: 0, ignoredInstructions: [], outerMarker: null, warnings: [] };
  const skillsAudit = await auditCodexSkills(absoluteCwd, home, {
    projectRootMarkers: rootMarkers,
    projectRootMarkerSource: markerSource,
  });
  const user = await userInstructions(home);

  let project;
  if (!usableProjectConfiguration) {
    project = projectUnavailable(projectConfiguration);
  } else {
    const target = path.join(absoluteCwd, ".instructree-doctor-target");
    const explained = await explain(target, repository.root, {
      client: "codex",
      fallbackFilenames: projectConfiguration.settings.fallbackFilenames,
      maxBytes: projectConfiguration.settings.maxBytes,
    });
    project = {
      status: "resolved",
      files: explained.applicable,
      maxBytes: explained.codex.maxBytes,
      includedBytes: explained.codex.includedBytes,
      truncated: explained.codex.truncated,
      budgetExhausted: explained.codex.budgetExhausted,
      diagnostics: explained.diagnostics,
    };
  }

  const skills = skillSummary(skillsAudit);
  const attentionCount =
    projectConfiguration.issues.length +
    user.warnings.length +
    project.diagnostics.length +
    skills.disabledByUserConfigCount +
    skills.unmatchedConfigRuleCount +
    skills.configIssueCount +
    skills.duplicateCount +
    skills.metadataFailureCount +
    skills.metadataWarningCount +
    skills.scanErrorCount +
    boundary.ignoredInstructionCount +
    boundary.warnings.length +
    Number(project.truncated === true);

  return {
    client: "codex",
    profile: "codex-doctor",
    repository: {
      root: "<repository>",
      currentDirectory: normalize(path.relative(repository.root, absoluteCwd)) || ".",
      markerFound: repository.markerFound,
      marker: repository.marker,
      markers: rootMarkers,
      markerSource,
      boundary,
    },
    configuration: {
      path: "~/.codex/config.toml",
      exists: projectConfiguration.exists,
      project: projectConfiguration,
      skills: skillsAudit.configuration,
    },
    instructions: { user, project },
    skills,
    signals: { attentionCount },
    provenance: {
      sources: [CODEX_AGENTS_SOURCE, CODEX_SKILLS_SOURCE],
      limitations: [
        "Static pre-session preview; it does not inspect a running or resumed Codex session.",
        "Reads supported user configuration only; managed configuration, profiles, session flags, and project trust are not resolved.",
        "Does not include remote environments, plugins, product restrictions, or Codex admin/system skill roots.",
        "Repository and home paths are logical and redacted; symlink and sandbox behavior can differ at runtime.",
      ],
    },
  };
}
