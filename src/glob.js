function escapeRegex(character) {
  return /[|\\{}()[\]^$+?.]/.test(character) ? `\\${character}` : character;
}

function expandBraces(pattern) {
  const match = pattern.match(/\{([^{}]+)\}/);
  if (!match) return [pattern];
  return match[1]
    .split(",")
    .flatMap((part) => expandBraces(pattern.replace(match[0], part.trim())));
}

export function globToRegExp(input) {
  let pattern = input.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(character);
    }
  }

  return new RegExp(`${source}$`);
}

export function matchesGlob(filePath, pattern) {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return expandBraces(pattern).some((expanded) => globToRegExp(expanded).test(normalized));
}
