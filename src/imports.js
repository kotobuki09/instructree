import fs from "node:fs/promises";
import path from "node:path";

const MAX_IMPORTED_FILES = 256;
const MAX_IMPORT_DEPTH = 32;
const MAX_FILE_BYTES = 256 * 1024;

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isCopilotImportRoot(file) {
  const basename = path.posix.basename(file.path);
  return (
    file.path.toLowerCase() === ".github/copilot-instructions.md" ||
    basename === "AGENTS.md" ||
    basename === "CLAUDE.md"
  );
}

export function findImportReferences(content) {
  const references = [];
  let fence = null;
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      fence = fence === marker ? null : fence ?? marker;
      continue;
    }
    if (fence) continue;

    const importMatch = line.match(/^\s*@(.+?)\s*$/);
    if (importMatch) references.push({ raw: importMatch[1], line: index + 1 });
  }
  return references;
}

function importDiagnostic(edge, severity, code, message) {
  return { file: edge.from, severity, code, line: edge.line, message };
}

async function resolveReference(root, realRoot, from, reference) {
  const raw = reference.raw.trim();
  if (/^(?:~[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(raw)) {
    return { status: "absolute", raw };
  }

  const absolute = path.resolve(root, path.posix.dirname(from), raw);
  if (!isInside(root, absolute)) return { status: "outside", raw };

  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return { status: "missing", raw };
    return { status: "unreadable", raw, error: error.message };
  }
  if (!stat.isFile()) return { status: "not-file", raw };

  let realTarget;
  try {
    realTarget = await fs.realpath(absolute);
  } catch (error) {
    return { status: "unreadable", raw, error: error.message };
  }
  if (!isInside(realRoot, realTarget)) return { status: "outside", raw };
  return { status: "valid", raw, absolute, target: normalize(path.relative(root, absolute)) };
}

export async function buildImportGraph(root, analyzedFiles) {
  const roots = analyzedFiles.filter(isCopilotImportRoot).map((file) => file.path).sort();
  const sourceFiles = new Map(analyzedFiles.map((file) => [file.path, file.content]));
  const realRoot = await fs.realpath(root);
  const nodes = new Map();
  const edges = [];
  const diagnostics = [];
  const queue = [...roots];

  while (queue.length > 0) {
    const relativePath = queue.shift();
    if (nodes.has(relativePath)) continue;
    if (nodes.size >= MAX_IMPORTED_FILES) {
      diagnostics.push({
        file: relativePath,
        severity: "error",
        code: "E406",
        line: 1,
        message: `import graph exceeds the ${MAX_IMPORTED_FILES}-file safety limit`,
      });
      break;
    }

    let content = sourceFiles.get(relativePath);
    if (content === undefined) {
      try {
        content = await fs.readFile(path.join(root, relativePath), "utf8");
      } catch (error) {
        diagnostics.push({
          file: relativePath,
          severity: "error",
          code: "E407",
          line: 1,
          message: `could not read imported file: ${error.message}`,
        });
        continue;
      }
    }

    const bytes = Buffer.byteLength(content);
    const node = { path: relativePath, root: roots.includes(relativePath), bytes };
    nodes.set(relativePath, node);
    if (bytes > MAX_FILE_BYTES) {
      diagnostics.push({
        file: relativePath,
        severity: "error",
        code: "E408",
        line: 1,
        message: `file exceeds the ${MAX_FILE_BYTES}-byte import safety limit`,
      });
      continue;
    }

    for (const reference of findImportReferences(content)) {
      const resolved = await resolveReference(root, realRoot, relativePath, reference);
      const edge = { from: relativePath, line: reference.line, raw: resolved.raw, status: resolved.status };
      if (resolved.target) edge.to = resolved.target;
      edges.push(edge);

      if (resolved.status === "valid") {
        if (!nodes.has(resolved.target) && !queue.includes(resolved.target)) queue.push(resolved.target);
      } else {
        const details = {
          absolute: ["error", "E401", `absolute import '${resolved.raw}' is not loaded by Copilot`],
          outside: ["error", "E402", `import '${resolved.raw}' escapes the repository`],
          missing: ["error", "E403", `import target '${resolved.raw}' does not exist`],
          "not-file": ["error", "E404", `import target '${resolved.raw}' is not a file`],
          unreadable: ["error", "E407", `could not read import '${resolved.raw}'${resolved.error ? `: ${resolved.error}` : ""}`],
        }[resolved.status];
        diagnostics.push(importDiagnostic(edge, ...details));
      }
    }
  }

  edges.sort((left, right) => left.from.localeCompare(right.from) || left.line - right.line || left.raw.localeCompare(right.raw));
  const adjacency = new Map();
  for (const edge of edges.filter((item) => item.status === "valid")) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge);
  }

  const cycles = [];
  const effectiveFiles = {};
  const reportedCycles = new Set();
  const reportedDuplicates = new Set();
  const reportedDepth = new Set();

  for (const rootFile of roots) {
    const visited = new Set();
    const stack = [];
    const effective = [];

    function walk(current, depth) {
      if (depth > MAX_IMPORT_DEPTH) {
        const key = `${rootFile}:${current}`;
        if (!reportedDepth.has(key)) {
          diagnostics.push({
            file: current,
            severity: "error",
            code: "E409",
            line: 1,
            message: `import chain from ${rootFile} exceeds the depth limit of ${MAX_IMPORT_DEPTH}`,
          });
          reportedDepth.add(key);
        }
        return;
      }

      visited.add(current);
      effective.push(current);
      stack.push(current);
      for (const edge of adjacency.get(current) ?? []) {
        const cycleStart = stack.indexOf(edge.to);
        if (cycleStart !== -1) {
          const cycle = [...stack.slice(cycleStart), edge.to];
          const key = `${edge.from}:${edge.line}:${edge.to}`;
          if (!reportedCycles.has(key)) {
            cycles.push(cycle);
            diagnostics.push(importDiagnostic(edge, "error", "E405", `import cycle: ${cycle.join(" -> ")}`));
            reportedCycles.add(key);
          }
          continue;
        }
        if (visited.has(edge.to)) {
          const key = `${rootFile}:${edge.from}:${edge.line}:${edge.to}`;
          if (!reportedDuplicates.has(key)) {
            diagnostics.push(
              importDiagnostic(edge, "note", "I401", `'${edge.to}' is included more than once from ${rootFile}`),
            );
            reportedDuplicates.add(key);
          }
          continue;
        }
        walk(edge.to, depth + 1);
      }
      stack.pop();
    }

    walk(rootFile, 0);
    effectiveFiles[rootFile] = effective;
  }

  return {
    profile: "github-copilot-cli",
    roots,
    nodes: [...nodes.values()].sort((left, right) => left.path.localeCompare(right.path)),
    edges,
    imports: edges.filter((edge) => edge.status === "valid"),
    missingImports: edges.filter((edge) => edge.status === "missing"),
    blockedImports: edges.filter((edge) => !["valid", "missing"].includes(edge.status)),
    cycles,
    effectiveFiles,
    diagnostics,
  };
}
