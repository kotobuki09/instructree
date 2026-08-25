function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((item) => unquote(item))
    .filter(Boolean);
}

export function parseFrontmatter(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") {
    return {
      present: false,
      data: {},
      keyLines: {},
      errors: [],
      body: content,
      bodyLine: 1,
    };
  }

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) {
    return {
      present: true,
      data: {},
      keyLines: {},
      errors: [{ line: 1, message: "frontmatter is missing its closing ---" }],
      body: "",
      bodyLine: lines.length + 1,
    };
  }

  const data = {};
  const keyLines = {};
  const errors = [];
  let currentKey = null;

  for (let index = 1; index < end; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const topLevel = raw.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (topLevel) {
      const [, key, rawValue = ""] = topLevel;
      if (Object.hasOwn(data, key)) {
        errors.push({ line: index + 1, message: `duplicate frontmatter key '${key}'` });
      }
      const inlineList = parseInlineList(rawValue);
      data[key] = inlineList ?? unquote(rawValue);
      keyLines[key] = index + 1;
      currentKey = key;
      continue;
    }

    const listItem = raw.match(/^\s+-\s+(.+)$/);
    if (listItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(unquote(listItem[1]));
      continue;
    }

    // Nested YAML belongs to the current top-level key. We only need top-level
    // fields, so preserve it without pretending to be a full YAML parser.
    if (/^\s+\S/.test(raw) && currentKey) continue;

    errors.push({ line: index + 1, message: "could not parse this frontmatter line" });
  }

  return {
    present: true,
    data,
    keyLines,
    errors,
    body: lines.slice(end + 1).join("\n"),
    bodyLine: end + 2,
  };
}

export function listValue(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((item) => unquote(item))
    .map((item) => item.trim())
    .filter(Boolean);
}
