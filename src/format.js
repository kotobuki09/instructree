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

export function formatExplain(result) {
  const lines = [`${bold("instructree explain")} ${dim("·")} ${result.target}`, ""];
  if (result.applicable.length === 0) {
    lines.push(dim("No automatically applicable instruction files found."));
  } else {
    lines.push(cyan("may apply, broad → specific"));
    result.applicable.forEach((file, index) => {
      lines.push(`${index + 1}. ${file.path} ${dim(`[${file.family} · ${file.reason}]`)}`);
    });
  }
  if (result.available.length > 0) {
    lines.push("", cyan("available on demand"));
    result.available.forEach((file) => lines.push(`- ${file.path} ${dim(`[${file.family}]`)}`));
  }
  lines.push("", dim("Static result: clients can differ in discovery and precedence behavior."));
  return lines.join("\n");
}
