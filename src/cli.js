import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { explain, scan } from "./index.js";
import { formatExplain, formatScan } from "./format.js";

const packagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");

function usage() {
  return `instructree — map and lint AI coding-agent instructions

Usage:
  instructree [scan] [root] [--json] [--strict]
  instructree explain <file> [--root <root>] [--json]
  instructree --help | --version

Exit codes:
  0  no schema errors (and no warnings with --strict)
  1  diagnostics failed the selected policy
  2  invalid arguments or runtime error`;
}

function parseArguments(argv) {
  const options = { command: "scan", json: false, strict: false, root: null, target: null };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--strict") options.strict = true;
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
    if (positional[0] === "scan") positional.shift();
    options.root ??= positional[0] ?? process.cwd();
    if (positional.length > 1) throw new Error(`unexpected argument: ${positional[1]}`);
  }
  return options;
}

function jsonResult(result) {
  return JSON.stringify(
    {
      root: result.root,
      ...(result.target ? { target: result.target, applicable: result.applicable, available: result.available } : {}),
      files: result.files.map(({ absolutePath, content, frontmatter, ...file }) => file),
      diagnostics: result.diagnostics,
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

  const result =
    options.command === "explain"
      ? await explain(options.target, options.root ?? process.cwd())
      : await scan(options.root);
  io.log(options.json ? jsonResult(result) : options.command === "explain" ? formatExplain(result) : formatScan(result));

  const hasErrors = result.diagnostics.some((item) => item.severity === "error");
  const hasWarnings = result.diagnostics.some((item) => item.severity === "warning");
  const exitCode = hasErrors || (options.strict && hasWarnings) ? 1 : 0;
  process.exitCode = exitCode;
  return exitCode;
}
