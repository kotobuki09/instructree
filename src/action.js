import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "./index.js";
import { formatScan } from "./format.js";

function escapeData(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeProperty(value) {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

function input(environment, name, fallback) {
  return environment[`INPUT_${name.toUpperCase()}`]?.trim() || fallback;
}

function booleanInput(environment, name) {
  const value = input(environment, name, "false").toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be 'true' or 'false'`);
}

function inside(base, target) {
  const relative = path.relative(base, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function annotation(diagnostic, root, workspace) {
  const command = diagnostic.severity === "error" ? "error" : diagnostic.severity === "warning" ? "warning" : "notice";
  const file = path.relative(workspace, path.resolve(root, diagnostic.file)).split(path.sep).join("/");
  const properties = `file=${escapeProperty(file)},line=${diagnostic.line},title=${escapeProperty(`Instructree ${diagnostic.code}`)}`;
  return `::${command} ${properties}::${escapeData(diagnostic.message)}`;
}

export async function runAction(environment = process.env, io = console) {
  try {
    const workspace = path.resolve(environment.GITHUB_WORKSPACE || process.cwd());
    const root = path.resolve(workspace, input(environment, "root", "."));
    const strict = booleanInput(environment, "strict");
    if (!inside(workspace, root)) throw new Error("root must be inside GITHUB_WORKSPACE");

    const result = await scan(root);
    for (const diagnostic of result.diagnostics) io.log(annotation(diagnostic, root, workspace));
    io.log(formatScan(result));

    const hasErrors = result.diagnostics.some((item) => item.severity === "error");
    const hasWarnings = result.diagnostics.some((item) => item.severity === "warning");
    return hasErrors || (strict && hasWarnings) ? 1 : 0;
  } catch (error) {
    io.log(`::error title=Instructree::${escapeData(error.message)}`);
    return 2;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = await runAction();
