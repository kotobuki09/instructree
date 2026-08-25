import path from "node:path";
import { pathToFileURL } from "node:url";

const RULES = [
  ["E001", "invalid-frontmatter", "Invalid YAML frontmatter", "error", "high"],
  ["E002", "missing-frontmatter", "Required YAML frontmatter is missing", "error", "high"],
  ["E003", "missing-required-field", "A required frontmatter field is missing", "error", "high"],
  ["E004", "invalid-skill-name", "The skill name is not portable kebab-case", "error", "high"],
  ["W101", "mismatched-skill-name", "The skill name does not match its folder", "warning", "high"],
  ["I101", "unscoped-instruction", "The instruction file has no automatic path scope", "note", "high"],
  ["W201", "invalid-link-encoding", "A local Markdown link has invalid encoding", "warning", "high"],
  ["W202", "broken-local-link", "A local Markdown link target does not exist", "warning", "high"],
  ["E201", "duplicate-skill-name", "The skill name is duplicated", "error", "high"],
  ["W301", "possible-instruction-conflict", "Overlapping instructions may conflict", "warning", "low"],
  ["E401", "absolute-import", "An absolute Copilot instruction import is not allowed", "error", "high"],
  ["E402", "out-of-repository-import", "A Copilot instruction import escapes the repository", "error", "high"],
  ["E403", "missing-import", "A Copilot instruction import target does not exist", "error", "high"],
  ["E404", "non-file-import", "A Copilot instruction import target is not a file", "error", "high"],
  ["E405", "import-cycle", "The Copilot instruction import graph contains a cycle", "error", "high"],
  ["E406", "import-file-limit", "The Copilot instruction import graph exceeds its file limit", "error", "high"],
  ["E407", "unreadable-import", "A Copilot instruction import cannot be read", "error", "high"],
  ["E408", "oversized-import", "A Copilot instruction import exceeds its size limit", "error", "high"],
  ["E409", "import-depth-limit", "The Copilot instruction import graph exceeds its depth limit", "error", "high"],
  ["I401", "duplicate-import", "A Copilot instruction file is imported more than once", "note", "high"],
];

function rootUri(root) {
  const withTrailingSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return pathToFileURL(withTrailingSeparator).href;
}

function artifactUri(file) {
  return file.split("/").map(encodeURIComponent).join("/");
}

function problemSeverity(level) {
  return level === "note" ? "recommendation" : level;
}

export function formatSarif(result, semanticVersion) {
  const rules = RULES.map(([id, name, description, level, precision]) => ({
    id,
    name,
    shortDescription: { text: description },
    defaultConfiguration: { level },
    properties: {
      tags: ["configuration", "agent-instructions"],
      precision,
      "problem.severity": problemSeverity(level),
    },
  }));
  const ruleIndices = new Map(rules.map((rule, index) => [rule.id, index]));
  const results = result.diagnostics.map((diagnostic) => {
    const ruleIndex = ruleIndices.get(diagnostic.code);
    if (ruleIndex === undefined) throw new Error(`missing SARIF rule metadata for ${diagnostic.code}`);
    return {
      ruleId: diagnostic.code,
      ruleIndex,
      level: diagnostic.severity,
      message: { text: diagnostic.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: artifactUri(diagnostic.file),
              uriBaseId: "%SRCROOT%",
            },
            region: { startLine: diagnostic.line },
          },
        },
      ],
    };
  });

  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "Instructree",
              informationUri: "https://github.com/kotobuki09/instructree",
              semanticVersion,
              rules,
            },
          },
          originalUriBaseIds: {
            "%SRCROOT%": {
              uri: rootUri(result.root),
              description: { text: "The repository root analyzed by Instructree." },
            },
          },
          results,
        },
      ],
    },
    null,
    2,
  );
}
