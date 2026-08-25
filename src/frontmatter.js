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

function blockScalarIndicator(value) {
  const match = value.trim().match(/^([>|])([+-]?)(?:\s+#.*)?$/);
  return match ? { style: match[1], chomping: match[2] } : null;
}

function parseBlockScalar(lines, start, end, indicator) {
  const blockLines = [];
  let contentIndent = null;
  let index = start + 1;

  for (; index < end; index += 1) {
    const raw = lines[index];
    if (raw.trim() === "") {
      blockLines.push("");
      continue;
    }

    const indent = raw.match(/^\s*/)[0].length;
    if (indent === 0 || (contentIndent !== null && indent < contentIndent)) break;
    contentIndent ??= indent;
    blockLines.push(raw.slice(contentIndent));
  }

  let value;
  if (indicator.style === ">") {
    value = "";
    for (const line of blockLines) {
      if (line === "") value += "\n";
      else if (value && !value.endsWith("\n")) value += " ";
      value += line;
    }
  } else {
    value = blockLines.join("\n");
  }

  if (indicator.chomping === "-") value = value.replace(/\n+$/g, "");
  else if (indicator.chomping !== "+") value = value.replace(/\n*$/g, "") + (blockLines.length > 0 ? "\n" : "");
  return { value, nextIndex: index - 1 };
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
      const blockIndicator = blockScalarIndicator(rawValue);
      if (blockIndicator) {
        const block = parseBlockScalar(lines, index, end, blockIndicator);
        data[key] = block.value;
        keyLines[key] = index + 1;
        currentKey = key;
        index = block.nextIndex;
        continue;
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
