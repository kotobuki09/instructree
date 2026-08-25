import fs from "node:fs/promises";
import path from "node:path";
import { resolveCodexProjectConfig } from "./codex-config.js";
import { explain } from "./index.js";
import { auditCodexSkills, findCodexProjectRoot } from "./skills.js";

const CODEX_AGENTS_SOURCE = "https://github.com/openai/codex/blob/0b94751cc463d02dec397c4c4dbb77fd9b93d94d/codex-rs/core/src/agents_md.rs";
const CODEX_SKILLS_SOURCE = "https://developers.openai.com/codex/skills";

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
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
