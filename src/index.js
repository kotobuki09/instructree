import path from "node:path";
import fs from "node:fs/promises";
import { discover } from "./discovery.js";
import { matchesGlob } from "./glob.js";
import { analyze } from "./rules.js";
import { buildImportGraph } from "./imports.js";

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

export async function scan(root = process.cwd()) {
  const absoluteRoot = path.resolve(root);
  const stat = await fs.stat(absoluteRoot);
  if (!stat.isDirectory()) throw new Error(`not a directory: ${absoluteRoot}`);
  const discovered = await discover(absoluteRoot);
  const result = await analyze(discovered);
  const imports = await buildImportGraph(absoluteRoot, result.files);
  const diagnostics = [...result.diagnostics, ...imports.diagnostics].sort((left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line || left.code.localeCompare(right.code),
  );
  return { root: absoluteRoot, ...result, diagnostics, imports };
}

function isInsideScope(target, scope) {
  return scope === "." || target === scope || target.startsWith(`${scope}/`);
}

function codexProjectChain(files, relativeTarget) {
  const targetDirectory = path.posix.dirname(relativeTarget);
  const directories = ["."];
  let current = "";
  if (targetDirectory !== ".") {
    for (const segment of targetDirectory.split("/")) {
      current = current ? `${current}/${segment}` : segment;
      directories.push(current);
    }
  }

  const filesByPath = new Map(files.map((file) => [file.path, file]));
  return directories.flatMap((directory) => {
    const prefix = directory === "." ? "" : `${directory}/`;
    const override = filesByPath.get(`${prefix}AGENTS.override.md`);
    const base = filesByPath.get(`${prefix}AGENTS.md`);
    const selected = [override, base].find((file) => file?.content.trim());
    if (!selected) return [];
    return [{
      path: selected.path,
      family: selected.family,
      kind: selected.kind,
      reason: directory === "." ? "repository-wide" : `directory scope: ${directory}/`,
    }];
  });
}

export async function explain(target, root = process.cwd(), options = {}) {
  const result = await scan(root);
  const relativeTarget = normalize(path.relative(result.root, path.resolve(result.root, target)));
  if (relativeTarget === ".." || relativeTarget.startsWith("../")) {
    throw new Error("the target must be inside the repository root");
  }

  if (options.client === "codex") {
    return {
      ...result,
      target: relativeTarget,
      client: "codex",
      profile: "codex",
      applicable: codexProjectChain(result.files, relativeTarget),
      available: [],
      effective: [],
    };
  }

  const applicable = [];
  const available = [];
  for (const file of result.files) {
    let reason = null;
    if (file.kind === "always" && isInsideScope(relativeTarget, file.scope)) {
      reason = file.scope === "." ? "repository-wide" : `directory scope: ${file.scope}/`;
    } else if (file.kind === "scoped" && file.patterns.some((pattern) => matchesGlob(relativeTarget, pattern))) {
      reason = file.patterns.filter((pattern) => matchesGlob(relativeTarget, pattern)).join(", ");
    }

    const summary = { path: file.path, family: file.family, kind: file.kind, reason };
    if (reason) applicable.push(summary);
    else if (["skill", "agent"].includes(file.kind)) available.push(summary);
  }

  applicable.sort((left, right) => {
    const leftDepth = left.path.split("/").length;
    const rightDepth = right.path.split("/").length;
    return leftDepth - rightDepth || left.path.localeCompare(right.path);
  });
  const effective = [];
  const seenEffective = new Set();
  for (const file of applicable) {
    for (const imported of result.imports.effectiveFiles[file.path] ?? []) {
      if (imported === file.path || seenEffective.has(imported)) continue;
      effective.push({ path: imported, importedBy: file.path, profile: result.imports.profile });
      seenEffective.add(imported);
    }
  }
  return { ...result, target: relativeTarget, applicable, available, effective };
}
