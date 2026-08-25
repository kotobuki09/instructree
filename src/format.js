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

export function formatSkills(result) {
  const lines = [
    `${bold("instructree skills")} ${dim("· Codex local skill-scope audit")}`,
    `${dim("repository cwd:")} ${result.repository.currentDirectory}`,
    "",
  ];
  for (const scope of result.scopes) {
    const label = scope.scope === "user" ? "user scope" : `repository scope · ${scope.directory}`;
    lines.push(cyan(`${label} · ${scope.path}`));
    if (!scope.exists) lines.push(dim("└─ not present"));
    else if (!scope.isDirectory) lines.push(red("└─ not a directory"));
    else if (scope.skills.length === 0) lines.push(dim("└─ no SKILL.md files found"));
    else scope.skills.forEach((skill, index) => {
      const connector = index === scope.skills.length - 1 ? "└─" : "├─";
      const status = skill.metadata.valid ? "valid" : `${skill.metadata.failures.length} metadata issue${skill.metadata.failures.length === 1 ? "" : "s"}`;
      lines.push(`${connector} ${skill.path} ${dim(`[${skill.name ?? "unnamed"} · ${status}]`)}`);
    });
  }
  lines.push(
    "",
    cyan("signals"),
    `duplicate names: ${result.signals.duplicateCount} · metadata failures: ${result.signals.metadataFailureCount} · metadata warnings: ${result.signals.metadataWarningCount} · scan errors: ${result.signals.scanErrorCount}`,
    `skill-list estimate: ${result.pressure.status} · ${result.pressure.estimatedInitialListChars}/${result.pressure.unknownContextWindowReferenceChars} chars`,
  );
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
  lines.push("", dim("limitations"));
  result.provenance.limitations.forEach((limitation) => lines.push(dim(`- ${limitation}`)));
  lines.push("", dim(`Read-only candidate-scope audit; source: ${result.provenance.source}`));
  return lines.join("\n");
}
