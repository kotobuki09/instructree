import { auditCodexSkills } from "./skills.js";

const SKILLS_DIRECTORY = "https://www.skills.sh";

const CODEX_COMPANIONS = [
  {
    name: "find-skills",
    purpose: "Discover a missing capability before adding another general-purpose skill.",
    source: "vercel-labs/skills",
  },
  {
    name: "tdd",
    purpose: "Develop behavior through focused red-green-refactor slices.",
    source: "mattpocock/skills",
  },
  {
    name: "diagnosing-bugs",
    purpose: "Investigate difficult defects with a hypothesis-driven evidence loop.",
    source: "mattpocock/skills",
  },
  {
    name: "code-review",
    purpose: "Review changes against repository standards and the requested behavior.",
    source: "mattpocock/skills",
  },
  {
    name: "research",
    purpose: "Research changing tools and ecosystems from current sources.",
    source: "mattpocock/skills",
  },
  {
    name: "verification-before-completion",
    purpose: "Require fresh command evidence before completion claims.",
    source: "obra/superpowers",
  },
].map((companion) => ({
  ...companion,
  skillUrl: `${SKILLS_DIRECTORY}/${companion.source}/${companion.name}`,
  installCommand: `npx skills add ${companion.source} --skill ${companion.name} -g --agent codex`,
}));

function companionStatus(candidates) {
  if (candidates.length === 0) return "missing";
  const valid = candidates.filter((candidate) => candidate.metadata.valid);
  if (valid.length === 0) return "invalid";
  if (!valid.some((candidate) => candidate.configuredEnabled)) return "disabled";
  return "ready";
}

export async function auditCodexStarter(cwd = process.cwd(), home) {
  const audit = await auditCodexSkills(cwd, home);
  const companions = CODEX_COMPANIONS.map((recommendation) => {
    const candidates = audit.skills.filter((skill) => skill.name === recommendation.name);
    return {
      ...recommendation,
      status: companionStatus(candidates),
      candidateCount: candidates.length,
      candidates: candidates.map((candidate) => ({
        path: candidate.path,
        scope: candidate.scope,
        configuredEnabled: candidate.configuredEnabled,
        metadataValid: candidate.metadata.valid,
      })),
    };
  });
  const summary = { total: companions.length, ready: 0, disabled: 0, invalid: 0, missing: 0 };
  for (const companion of companions) summary[companion.status] += 1;

  return {
    client: "codex",
    profile: "codex-starter-stack",
    readOnly: true,
    repository: audit.repository,
    catalog: {
      candidateCount: audit.skills.length,
      configuredCandidateCount: audit.pressure.configuredCandidateCount,
      estimatedInitialListChars: audit.pressure.estimatedInitialListChars,
      configuredEstimatedInitialListChars: audit.pressure.configuredEstimatedInitialListChars,
      unknownContextWindowReferenceChars: audit.pressure.unknownContextWindowReferenceChars,
      status: audit.pressure.status,
      configuredStatus: audit.pressure.configuredStatus,
    },
    summary,
    companions,
    selection: {
      directory: SKILLS_DIRECTORY,
      reviewedAt: "2026-08-26",
      basis: "A small engineering stack covering discovery, testing, diagnosis, review, research, and verification. Popularity is a filter, not proof of quality or task fit.",
      safety: "Review each linked SKILL.md before installation because skills influence agent decisions.",
    },
    provenance: {
      sources: [
        "https://developers.openai.com/codex/skills",
        "https://www.skills.sh/docs",
      ],
      limitations: [
        "Static local audit; it does not install, download, enable, disable, or update skills.",
        "Matches companion candidates by declared skill name and does not identify their original repository after installation.",
        "Popularity and directory contents can change after the recorded review date.",
        ...audit.provenance.limitations,
      ],
    },
  };
}
