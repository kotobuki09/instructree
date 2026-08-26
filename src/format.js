const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, value) => (supportsColor ? `\u001b[${code}m${value}\u001b[0m` : value);
const bold = (value) => paint("1", value);
const dim = (value) => paint("2", value);
const red = (value) => paint("31", value);
const yellow = (value) => paint("33", value);
const cyan = (value) => paint("36", value);

function groupedFiles(files) {
  const groups = new Map();
  for (const file of files) {
    const label = {
      always: "always-on instructions",
      scoped: "path-scoped instructions",
      skill: "on-demand skills",
      agent: "custom agents",
      workflow: "agentic workflows",
    }[file.kind];
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(file);
  }
  return groups;
}

export function formatScan(result) {
  const lines = [`${bold("instructree")} ${dim("·")} ${result.root}`];
  if (result.files.length === 0) {
    lines.push("", dim("No supported instruction files found."));
  } else {
    for (const [label, files] of groupedFiles(result.files)) {
      lines.push("", cyan(label));
      files.forEach((file, index) => {
        const connector = index === files.length - 1 ? "└─" : "├─";
        const detail = file.patterns.length > 0 ? `  ${dim(file.patterns.join(", "))}` : "";
        lines.push(`${connector} ${file.path}${detail}`);
      });
    }
  }

  if (result.diagnostics.length > 0) {
    lines.push("");
    for (const item of result.diagnostics) {
      const marker = item.severity === "error" ? red("error") : item.severity === "warning" ? yellow("warn ") : dim("note ");
      lines.push(`${marker} ${item.code} ${item.file}:${item.line}  ${item.message}`);
    }
  }

  const errors = result.diagnostics.filter((item) => item.severity === "error").length;
  const warnings = result.diagnostics.filter((item) => item.severity === "warning").length;
  const notes = result.diagnostics.filter((item) => item.severity === "note").length;
  const verdict = errors > 0 ? red("failed") : warnings > 0 ? yellow("review") : "clean";
  lines.push("", `${verdict} ${dim("·")} ${result.files.length} files ${dim("·")} ${errors} errors ${dim("·")} ${warnings} warnings ${dim("·")} ${notes} notes`);
  return lines.join("\n");
}

export function formatExplain(result, showEffective = false) {
  const client = result.client === "codex" ? ` ${dim("· Codex project chain")}` : "";
  const lines = [`${bold("instructree explain")} ${dim("·")} ${result.target}${client}`, ""];
  if (result.codex) {
    const fallbacks = result.codex.fallbackFilenames.length > 0 ? result.codex.fallbackFilenames.join(", ") : "none";
    lines.push(dim(`configuration · fallbacks: ${fallbacks} · max bytes: ${result.codex.maxBytes}`), "");
  }
  if (result.applicable.length === 0) {
    lines.push(dim("No automatically applicable instruction files found."));
  } else {
    lines.push(cyan(result.client === "codex" ? "selected, broad → specific" : "may apply, broad → specific"));
    result.applicable.forEach((file, index) => {
      const bytes = result.client === "codex"
        ? file.empty
          ? ` · selected, empty${file.truncated ? ` · 0/${file.bytes} bytes, truncated` : ""}`
          : file.includedEmpty
            ? ` · 0/${file.bytes} bytes, truncated prefix is whitespace`
            : ` · ${file.includedBytes}/${file.bytes} bytes${file.truncated ? ", truncated" : ""}`
        : "";
      lines.push(`${index + 1}. ${file.path} ${dim(`[${file.family} · ${file.reason}${bytes}]`)}`);
    });
  }
  if (result.available.length > 0) {
    lines.push("", cyan("available on demand"));
    result.available.forEach((file) => lines.push(`- ${file.path} ${dim(`[${file.family}]`)}`));
  }
  if (showEffective) {
    lines.push("", cyan("effective transitive imports · GitHub Copilot CLI"));
    if (result.effective.length === 0) lines.push(dim("No imported instruction files."));
    else result.effective.forEach((file) => lines.push(`- ${file.path} ${dim(`[from ${file.importedBy}]`)}`));
  }
  lines.push(
    "",
    dim(
      result.client === "codex"
        ? "Repository-only result for configured Codex project instruction candidates."
        : "Static result: clients can differ in discovery and precedence behavior.",
    ),
  );
  return lines.join("\n");
}

export function formatImports(result) {
  const lines = [`${bold("instructree imports")} ${dim("· GitHub Copilot CLI ·")} ${result.root}`, ""];
  if (result.imports.roots.length === 0) {
    lines.push(dim("No Copilot-compatible import roots found."));
  } else {
    const adjacency = new Map();
    for (const edge of result.imports.edges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      adjacency.get(edge.from).push(edge);
    }

    function render(current, prefix, ancestors) {
      const children = adjacency.get(current) ?? [];
      children.forEach((edge, index) => {
        const last = index === children.length - 1;
        const connector = last ? "└─" : "├─";
        const label = edge.status === "valid" ? edge.to : `${edge.raw} [${edge.status}]`;
        const cycle = edge.to && ancestors.has(edge.to);
        lines.push(`${prefix}${connector} ${label}${cycle ? yellow(" [cycle]") : ""} ${dim(`:${edge.line}`)}`);
        if (edge.status === "valid" && !cycle) {
          render(edge.to, `${prefix}${last ? "   " : "│  "}`, new Set([...ancestors, edge.to]));
        }
      });
    }

    result.imports.roots.forEach((rootFile, index) => {
      if (index > 0) lines.push("");
      lines.push(cyan(rootFile));
      render(rootFile, "", new Set([rootFile]));
    });
  }

  if (result.imports.diagnostics.length > 0) {
    lines.push("");
    for (const item of result.imports.diagnostics) {
      const marker = item.severity === "error" ? red("error") : item.severity === "warning" ? yellow("warn ") : dim("note ");
      lines.push(`${marker} ${item.code} ${item.file}:${item.line}  ${item.message}`);
    }
  }

  const imported = result.imports.nodes.filter((node) => !node.root).length;
  const errors = result.imports.diagnostics.filter((item) => item.severity === "error").length;
  const rootLabel = `${result.imports.roots.length} root${result.imports.roots.length === 1 ? "" : "s"}`;
  const fileLabel = `${imported} imported file${imported === 1 ? "" : "s"}`;
  const errorLabel = `${errors} error${errors === 1 ? "" : "s"}`;
  lines.push("", `${errors > 0 ? red("failed") : "clean"} ${dim("·")} ${rootLabel} ${dim("·")} ${fileLabel} ${dim("·")} ${errorLabel}`);
  return lines.join("\n");
}

export function formatSkills(result, { showAll = false } = {}) {
  const lines = [
    `${bold("instructree skills")} ${dim("· Codex local skill-scope audit")}`,
    `${dim("repository cwd:")} ${result.repository.currentDirectory}`,
    "",
  ];
  for (const scope of result.scopes) {
    const label = scope.scope === "user"
      ? scope.variant === "legacy" ? "legacy user scope" : "user scope"
      : `repository scope · ${scope.directory}`;
    lines.push(cyan(`${label} · ${scope.path}`));
    if (!scope.exists) lines.push(dim("└─ not present"));
    else if (!scope.isDirectory) lines.push(red("└─ not a directory"));
    else if (scope.skills.length === 0) lines.push(dim("└─ no SKILL.md files found"));
    else if (!showAll) {
      const noun = scope.skills.length === 1 ? "skill candidate" : "skill candidates";
      lines.push(dim(`└─ ${scope.skills.length} ${noun} · full inventory omitted`));
    }
    else scope.skills.forEach((skill, index) => {
      const connector = index === scope.skills.length - 1 ? "└─" : "├─";
      const status = skill.metadata.valid ? "valid" : `${skill.metadata.failures.length} metadata issue${skill.metadata.failures.length === 1 ? "" : "s"}`;
      const configured = skill.configuredEnabled === false ? " · disabled by user config" : "";
      lines.push(`${connector} ${skill.path} ${dim(`[${skill.name ?? "unnamed"} · ${status}${configured}]`)}`);
    });
  }
  const configuration = result.configuration;
  lines.push("", cyan(`user config · ${configuration.path}`));
  if (configuration.status === "missing") lines.push(dim("└─ not present · all discovered candidates remain enabled by default"));
  else if (configuration.status === "unavailable") lines.push(dim("└─ home unavailable · user configuration was not inspected"));
  else if (configuration.status === "unreadable") lines.push(red("└─ unreadable · no user rules applied"));
  else if (configuration.status === "unsupported") lines.push(red("└─ unsupported relevant syntax · no user rules applied"));
  else {
    const catalog = configuration.settings.includeInstructions === false
      ? "disabled"
      : configuration.settings.includeInstructions === true
        ? "enabled"
        : "default";
    const bundled = configuration.settings.bundledEnabled === false
      ? "disabled"
      : configuration.settings.bundledEnabled === true
        ? "enabled"
        : "default";
    const maxContext = configuration.settings.maxContextTokens === null
      ? "default"
      : `${configuration.settings.maxContextTokens} tokens`;
    lines.push(dim(`catalog instructions: ${catalog} · bundled skills: ${bundled} · max context: ${maxContext}`));
    lines.push(dim(`rules: ${configuration.effectiveRuleCount} effective · ${configuration.matchedRuleCount} matched · ${configuration.disabledSkills.length} disabled · ${configuration.unmatchedRuleCount} unmatched`));
  }
  lines.push(
    "",
    cyan("signals"),
    `duplicate names: ${result.signals.duplicateCount} · symlinked candidates: ${result.signals.symlinkedSkillCount} · legacy-only user candidates: ${result.signals.legacyOnlyUserSkillCount} · metadata failures: ${result.signals.metadataFailureCount} · metadata warnings: ${result.signals.metadataWarningCount} · scan errors: ${result.signals.scanErrorCount}`,
    `skill-list estimate: ${result.pressure.status} · ${result.pressure.estimatedInitialListChars}/${result.pressure.unknownContextWindowReferenceChars} chars`,
  );
  const contributors = result.pressure.topConfiguredContributors;
  if (contributors.length > 0) {
    lines.push("", cyan(`largest configured contributors · top ${contributors.length} of ${result.pressure.configuredCandidateCount}`));
    contributors.forEach((contributor) => {
      const capped = contributor.descriptionTruncated ? " · description capped for estimate" : "";
      lines.push(`- ${contributor.name} · ${contributor.totalChars} chars${capped} · ${contributor.path}`);
    });
    lines.push(dim("Approximate fallback-character cost; inspect relevance before changing user configuration."));
  }
  if (result.duplicates.length > 0) {
    lines.push("", yellow("possible duplicate skill names"));
    result.duplicates.forEach((duplicate) => lines.push(`- ${duplicate.name} · ${duplicate.occurrences.map((item) => `${item.path}:${item.line ?? "?"}`).join(", ")}`));
  }
  if (result.metadataFailures.length > 0) {
    lines.push("", yellow("metadata failures"));
    result.metadataFailures.forEach((failure) => lines.push(`- ${failure.path}:${failure.line} · ${failure.message}`));
  }
  if (result.metadataWarnings.length > 0) {
    lines.push("", yellow("metadata warnings"));
    result.metadataWarnings.forEach((warning) => lines.push(`- ${warning.path}:${warning.line} · ${warning.message}`));
  }
  if (result.scanErrors.length > 0) {
    lines.push("", red("scan errors"));
    result.scanErrors.forEach((error) => lines.push(`- ${error.path}:${error.line} · ${error.message}`));
  }
  if (configuration.disabledSkills.length > 0) {
    lines.push("", yellow("disabled by user config"));
    configuration.disabledSkills.forEach((skill) => lines.push(`- ${skill.path} · ${skill.name ?? "unnamed"}`));
  }
  if (configuration.unmatchedRules.length > 0) {
    lines.push("", yellow("unmatched user config rules"));
    configuration.unmatchedRules.forEach((rule) => lines.push(`- ${configuration.path}:${rule.line} · ${rule.selector} ${rule.value} · ${rule.enabled ? "enabled" : "disabled"}`));
  }
  if (configuration.issues.length > 0) {
    lines.push("", red("user config issues"));
    configuration.issues.forEach((issue) => lines.push(`- ${issue.path}:${issue.line} · ${issue.message}`));
  }
  lines.push("", dim("limitations"));
  result.provenance.limitations.forEach((limitation) => lines.push(dim(`- ${limitation}`)));
  lines.push("", dim(`Read-only candidate-scope audit; source: ${result.provenance.source}`));
  return lines.join("\n");
}

export function formatStarter(result) {
  const lines = [
    `${bold("instructree starter")} ${dim("· read-only Codex companion audit")}`,
    `${dim("repository cwd:")} ${result.repository.currentDirectory}`,
    `${dim("catalog:")} ${result.catalog.candidateCount} candidates · ${result.catalog.configuredEstimatedInitialListChars}/${result.catalog.unknownContextWindowReferenceChars} configured estimate chars`,
    "",
    cyan(`focused stack · ${result.summary.ready}/${result.summary.total} ready`),
  ];
  const marker = { ready: "✓", disabled: "○", invalid: "!", missing: "–" };
  for (const companion of result.companions) {
    const status = companion.status === "ready"
      ? companion.status
      : companion.status === "missing"
        ? dim(companion.status)
        : yellow(companion.status);
    const count = companion.candidateCount > 1 ? ` · ${companion.candidateCount} candidates` : "";
    lines.push(`${marker[companion.status]} ${companion.name} · ${status}${count}`);
    lines.push(`  ${dim(companion.purpose)}`);
    lines.push(`  ${dim(companion.skillUrl)}`);
  }

  const missing = result.companions.filter((companion) => companion.status === "missing");
  lines.push("", cyan("commands for missing companions"));
  if (missing.length === 0) lines.push(dim("none"));
  else missing.forEach((companion) => lines.push(`$ ${companion.installCommand}`));
  lines.push(
    "",
    yellow("Review each linked SKILL.md before installation; skills influence agent decisions."),
    dim("This command does not install or change skills. No files changed."),
  );
  return lines.join("\n");
}

export function formatDoctor(result) {
  const { project: projectConfiguration } = result.configuration;
  const { user, project } = result.instructions;
  const marker = result.repository.markerFound
    ? `${result.repository.marker} · ${result.repository.markerSource}`
    : `none · ${result.repository.markerSource}`;
  const lines = [
    `${bold("instructree doctor")} ${dim("· Codex pre-session setup audit")}`,
    `${dim("repository cwd:")} ${result.repository.currentDirectory}`,
    `${dim("project root:")} <repository> ${dim(`· marker: ${marker}`)}`,
  ];

  if (result.repository.boundary.status === "attention") {
    lines.push(yellow(`root boundary: ${result.repository.boundary.ignoredInstructionCount} parent instruction${result.repository.boundary.ignoredInstructionCount === 1 ? "" : "s"} ignored above selected project root`));
    for (const instruction of result.repository.boundary.ignoredInstructions) {
      lines.push(yellow(`- ${instruction.path} · ignored above selected project root`));
    }
    if (result.repository.boundary.outerMarker) {
      lines.push(dim(`- outer marker: ${result.repository.boundary.outerMarker.marker} at ${result.repository.boundary.outerMarker.path}`));
    }
  } else if (result.repository.boundary.status === "clear") {
    lines.push(dim("root boundary: clear · no parent instructions hidden by an outer project marker"));
  } else {
    lines.push(dim("root boundary: unavailable · project configuration could not be resolved"));
  }
  for (const warning of result.repository.boundary.warnings) {
    lines.push(red(`- ${warning.path}:${warning.line} · ${warning.message}`));
  }

  lines.push("", cyan(`user config · ${result.configuration.path}`));

  if (["parsed", "missing"].includes(projectConfiguration.status)) {
    const fallbacks = projectConfiguration.settings.fallbackFilenames.length > 0
      ? projectConfiguration.settings.fallbackFilenames.join(", ")
      : "none";
    const markers = projectConfiguration.settings.rootMarkers.length > 0
      ? projectConfiguration.settings.rootMarkers.join(", ")
      : "none (current directory only)";
    lines.push(dim(`status: ${projectConfiguration.status} · root markers: ${markers} · fallbacks: ${fallbacks} · max bytes: ${projectConfiguration.settings.maxBytes}`));
  } else {
    lines.push(red(`status: ${projectConfiguration.status} · project instruction preview unavailable`));
  }
  for (const issue of projectConfiguration.issues) {
    lines.push(red(`- ${issue.path}:${issue.line} · ${issue.message}`));
  }

  lines.push("", cyan("user instructions"));
  if (user.selected) lines.push(`- ${user.selected.path} ${dim(`· ${user.selected.bytes} bytes · selected`)}`);
  else lines.push(dim(`- ${user.status}`));
  for (const skipped of user.skippedEmpty) lines.push(dim(`- ${skipped.path} · empty, skipped`));
  for (const warning of user.warnings) lines.push(red(`- ${warning.path}:${warning.line} · ${warning.message}`));

  lines.push("", cyan("project instructions"));
  if (project.status !== "resolved") {
    lines.push(red(`- unavailable · ${project.reason}`));
  } else if (project.files.length === 0) {
    lines.push(dim("- no selected project instruction files"));
  } else {
    project.files.forEach((file, index) => {
      const bytes = file.empty
        ? "selected, empty"
        : `${file.includedBytes}/${file.bytes} bytes${file.truncated ? ", truncated" : ""}`;
      lines.push(`${index + 1}. ${file.path} ${dim(`· ${bytes}`)}`);
    });
    lines.push(dim(`total: ${project.includedBytes}/${project.maxBytes} bytes${project.budgetExhausted ? " · budget exhausted" : ""}`));
  }
  for (const diagnostic of project.diagnostics) {
    const markerLabel = diagnostic.severity === "error" ? red("error") : diagnostic.severity === "warning" ? yellow("warn ") : dim("note ");
    lines.push(`${markerLabel} ${diagnostic.code} ${diagnostic.file}:${diagnostic.line} · ${diagnostic.message}`);
  }

  lines.push(
    "",
    cyan("skills"),
    `candidates: ${result.skills.candidateCount} · configured: ${result.skills.configuredCandidateCount} · disabled: ${result.skills.disabledByUserConfigCount}`,
    `duplicates: ${result.skills.duplicateCount} · metadata failures: ${result.skills.metadataFailureCount} · metadata warnings: ${result.skills.metadataWarningCount} · scan errors: ${result.skills.scanErrorCount}`,
  );
  for (const skill of result.skills.disabledSkills) lines.push(yellow(`- disabled by user config · ${skill.name ?? "unnamed"} · ${skill.path}`));
  for (const duplicate of result.skills.duplicates) lines.push(yellow(`- duplicate name · ${duplicate.name}`));
  for (const issue of result.skills.configIssues) lines.push(red(`- ${issue.path}:${issue.line} · ${issue.message}`));

  lines.push("", dim(`attention signals: ${result.signals.attentionCount}`), "", dim("limitations"));
  result.provenance.limitations.forEach((limitation) => lines.push(dim(`- ${limitation}`)));
  return lines.join("\n");
}
