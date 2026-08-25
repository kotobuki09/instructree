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

const CODEX_DEFAULT_MAX_BYTES = 32768;
const CODEX_STANDARD_FILENAMES = ["AGENTS.override.md", "AGENTS.md"];

function codexConfiguration(options) {
  const fallbackFilenames = options.fallbackFilenames ?? [];
  if (!Array.isArray(fallbackFilenames)) throw new Error("Codex fallbackFilenames must be an array");
  for (const filename of fallbackFilenames) {
    if (
      typeof filename !== "string" ||
      filename.length === 0 ||
      filename !== filename.trim() ||
      filename === "." ||
      filename === ".." ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes("\0")
    ) {
      throw new Error(`Codex fallback must be a repository-local filename: ${String(filename)}`);
    }
  }

  const maxBytes = options.maxBytes ?? CODEX_DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Codex maxBytes must be a positive integer");
  }
  return { fallbackFilenames: [...fallbackFilenames], maxBytes };
}

function isInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function firstCodexCandidate(root, realRoot, directory, candidateFilenames) {
  for (const filename of candidateFilenames) {
    const relativePath = directory === "." ? filename : `${directory}/${filename}`;
    const absolutePath = path.join(root, ...relativePath.split("/"));
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) continue;
      throw error;
    }
    if (!stat.isFile()) continue;
    const realCandidate = await fs.realpath(absolutePath);
    if (!isInsideRoot(realRoot, realCandidate)) {
      throw new Error(`Codex project instruction resolves outside the repository root: ${relativePath}`);
    }
    return { relativePath, absolutePath };
  }
  return null;
}

async function codexProjectChain(root, files, relativeTarget, configuration) {
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
  const candidateFilenames = [...new Set([...CODEX_STANDARD_FILENAMES, ...configuration.fallbackFilenames])];
  const realRoot = await fs.realpath(root);
  const applicable = [];
  let remainingBytes = configuration.maxBytes;

  for (const directory of directories) {
    if (remainingBytes === 0) break;
    const selected = await firstCodexCandidate(root, realRoot, directory, candidateFilenames);
    if (!selected) continue;

    const data = await fs.readFile(selected.absolutePath);
    const included = data.subarray(0, remainingBytes);
    const empty = included.toString("utf8").trim().length === 0;
    const includedBytes = empty ? 0 : included.length;
    const knownFile = filesByPath.get(selected.relativePath);
    applicable.push({
      path: selected.relativePath,
      family: knownFile?.family ?? "Codex",
      kind: knownFile?.kind ?? "always",
      reason: directory === "." ? "repository-wide" : `directory scope: ${directory}/`,
      bytes: data.length,
      includedBytes,
      truncated: data.length > remainingBytes,
      empty,
    });
    remainingBytes -= includedBytes;
  }

  return {
    applicable,
    metadata: {
      fallbackFilenames: configuration.fallbackFilenames,
      maxBytes: configuration.maxBytes,
      includedBytes: configuration.maxBytes - remainingBytes,
      truncated: applicable.some((file) => file.truncated),
      budgetExhausted: remainingBytes === 0,
    },
  };
}

export async function explain(target, root = process.cwd(), options = {}) {
  const configuration = options.client === "codex" ? codexConfiguration(options) : null;
  const result = await scan(root);
  const relativeTarget = normalize(path.relative(result.root, path.resolve(result.root, target)));
  if (relativeTarget === ".." || relativeTarget.startsWith("../")) {
    throw new Error("the target must be inside the repository root");
  }

  if (options.client === "codex") {
    const chain = await codexProjectChain(result.root, result.files, relativeTarget, configuration);
    return {
      ...result,
      target: relativeTarget,
      client: "codex",
      profile: "codex",
      codex: chain.metadata,
      applicable: chain.applicable,
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
