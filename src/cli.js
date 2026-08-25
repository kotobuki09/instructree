import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { explain, scan } from "./index.js";
import { formatExplain, formatImports, formatScan } from "./format.js";
import { formatSarif } from "./sarif.js";

const packagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");

function usage() {
  return `instructree — map and lint AI coding-agent instructions

Usage:
  instructree [scan] [root] [--json | --sarif] [--strict]
  instructree imports [root] [--json] [--strict]
  instructree explain <file> [--root <root>] [--client codex [--fallback <name>]... [--max-bytes <n>] | --effective] [--json]
  instructree init [root] [--code-scanning]
  instructree --help | --version

Exit codes:
  0  no schema errors (and no warnings with --strict)
  1  diagnostics failed the selected policy
  2  invalid arguments or runtime error`;
}

function parseArguments(argv) {
  const options = {
    command: "scan",
    json: false,
    sarif: false,
    strict: false,
    effective: false,
    client: null,
    fallbackFilenames: [],
    maxBytes: null,
    codeScanning: false,
    root: null,
    target: null,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--sarif") options.sarif = true;
    else if (argument === "--strict") options.strict = true;
    else if (argument === "--effective") options.effective = true;
    else if (argument === "--client") {
      options.client = argv[index + 1];
      index += 1;
      if (!options.client || options.client.startsWith("-")) throw new Error("--client requires a value");
    }
    else if (argument === "--fallback") {
      const filename = argv[index + 1];
      index += 1;
      if (!filename || filename.startsWith("-")) throw new Error("--fallback requires a filename");
      options.fallbackFilenames.push(filename);
    }
    else if (argument === "--max-bytes") {
      const value = argv[index + 1];
      index += 1;
      if (!value || !/^[1-9]\d*$/.test(value)) throw new Error("--max-bytes requires a positive integer");
      options.maxBytes = Number(value);
      if (!Number.isSafeInteger(options.maxBytes)) throw new Error("--max-bytes requires a positive integer");
    }
    else if (argument === "--code-scanning") options.codeScanning = true;
    else if (argument === "--root") {
      options.root = argv[index + 1];
      index += 1;
      if (!options.root) throw new Error("--root requires a directory");
    } else if (argument === "--help" || argument === "-h") options.command = "help";
    else if (argument === "--version" || argument === "-v") options.command = "version";
    else if (argument.startsWith("-")) throw new Error(`unknown option: ${argument}`);
    else positional.push(argument);
  }

  if (positional[0] === "explain") {
    options.command = "explain";
    options.target = positional[1];
    if (!options.target) throw new Error("explain requires a target file");
    if (positional.length > 2) throw new Error(`unexpected argument: ${positional[2]}`);
  } else {
    if (["scan", "imports", "init"].includes(positional[0])) options.command = positional.shift();
    options.root ??= positional[0] ?? process.cwd();
    if (positional.length > 1) throw new Error(`unexpected argument: ${positional[1]}`);
  }
  if (options.effective && options.command !== "explain") {
    throw new Error("--effective can only be used with explain");
  }
  if (options.client && options.client !== "codex") {
    throw new Error(`unknown client: ${options.client}`);
  }
  if (options.client && options.command !== "explain") {
    throw new Error("--client can only be used with explain");
  }
  if (options.effective && options.client) {
    throw new Error("--effective and --client cannot be used together");
  }
  if ((options.fallbackFilenames.length > 0 || options.maxBytes !== null) && options.command !== "explain") {
    throw new Error("--fallback and --max-bytes require explain --client codex");
  }
  if ((options.fallbackFilenames.length > 0 || options.maxBytes !== null) && options.client !== "codex") {
    throw new Error("--fallback and --max-bytes require --client codex");
  }
  if (options.json && options.sarif) {
    throw new Error("--json and --sarif cannot be used together");
  }
  if (options.sarif && options.command !== "scan") {
    throw new Error("--sarif can only be used with scan");
  }
  if (options.codeScanning && options.command !== "init") {
    throw new Error("--code-scanning can only be used with init");
  }
  if (options.command === "init" && (options.json || options.strict || options.effective)) {
    throw new Error("init does not accept output or policy options");
  }
  return options;
}

async function ensureLocalDirectory(root, relativePath) {
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    try {
      const entry = await fs.lstat(current);
      if (entry.isSymbolicLink()) throw new Error(`refusing to write through symbolic link: ${segment}`);
      if (!entry.isDirectory()) throw new Error(`expected a directory: ${segment}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.mkdir(current);
    }
  }
  return current;
}

async function initializeWorkflow(root, version, io) {
  const resolvedRoot = await fs.realpath(path.resolve(root));
  const workflowDirectory = await ensureLocalDirectory(resolvedRoot, ".github/workflows");
  const workflowPath = path.join(workflowDirectory, "instructree.yml");
  const workflow = `name: instruction-lint
on: [pull_request]

permissions:
  contents: read

jobs:
  instructree:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: kotobuki09/instructree@v${version}
        with:
          strict: true
`;
  try {
    await fs.writeFile(workflowPath, workflow, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("workflow already exists: .github/workflows/instructree.yml");
    throw error;
  }
  io.log("created .github/workflows/instructree.yml");
  return 0;
}

async function initializeCodeScanningWorkflow(root, version, io) {
  const resolvedRoot = await fs.realpath(path.resolve(root));
  const workflowDirectory = await ensureLocalDirectory(resolvedRoot, ".github/workflows");
  const workflowPath = path.join(workflowDirectory, "code-scanning.yml");
  const workflow = `name: Instructree code scanning

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  instructree:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - name: Generate Instructree SARIF
        id: scan
        continue-on-error: true
        run: npx --yes github:kotobuki09/instructree#v${version} scan . --sarif > instructree.sarif
      - name: Upload Instructree SARIF
        if: \${{ always() && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) }}
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: instructree.sarif
          category: instructree
      - name: Enforce Instructree policy
        if: \${{ steps.scan.outcome == 'failure' }}
        run: exit 1
`;
  try {
    await fs.writeFile(workflowPath, workflow, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("workflow already exists: .github/workflows/code-scanning.yml");
    throw error;
  }
  io.log("created .github/workflows/code-scanning.yml");
  return 0;
}

function jsonResult(result, command) {
  if (command === "imports") {
    return JSON.stringify({ root: result.root, ...result.imports }, null, 2);
  }
  return JSON.stringify(
    {
      root: result.root,
      ...(result.client ? { client: result.client, profile: result.profile } : {}),
      ...(result.codex ? { codex: result.codex } : {}),
      ...(result.target ? { target: result.target, applicable: result.applicable, available: result.available } : {}),
      ...(result.target ? { effective: result.effective } : {}),
      files: result.files.map(({ absolutePath, content, frontmatter, ...file }) => file),
      diagnostics: result.diagnostics,
      imports: result.imports,
    },
    null,
    2,
  );
}

export async function run(argv, io = console) {
  const options = parseArguments(argv);
  if (options.command === "help") {
    io.log(usage());
    return 0;
  }
  if (options.command === "version") {
    const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8"));
    io.log(packageJson.version);
    return 0;
  }
  if (options.command === "init") {
    const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8"));
    if (options.codeScanning) {
      return initializeCodeScanningWorkflow(options.root, packageJson.version, io);
    }
    return initializeWorkflow(options.root, packageJson.version, io);
  }

  const result =
    options.command === "explain"
      ? await explain(options.target, options.root ?? process.cwd(), {
          client: options.client,
          fallbackFilenames: options.fallbackFilenames,
          ...(options.maxBytes === null ? {} : { maxBytes: options.maxBytes }),
        })
      : await scan(options.root);
  const sarif = options.sarif
    ? formatSarif(result, JSON.parse(await fs.readFile(packagePath, "utf8")).version)
    : null;
  io.log(
    options.sarif
      ? sarif
      : options.json
        ? jsonResult(result, options.command)
        : options.command === "explain"
          ? formatExplain(result, options.effective)
          : options.command === "imports"
            ? formatImports(result)
            : formatScan(result),
  );

  const policyDiagnostics = options.command === "imports" ? result.imports.diagnostics : result.diagnostics;
  const hasErrors = policyDiagnostics.some((item) => item.severity === "error");
  const hasWarnings = policyDiagnostics.some((item) => item.severity === "warning");
  const exitCode = hasErrors || (options.strict && hasWarnings) ? 1 : 0;
  process.exitCode = exitCode;
  return exitCode;
}
