export type ManuscriptPart = { name: string; text: string };

export function mergeManuscriptParts(
  existing: ManuscriptPart[],
  additions: ManuscriptPart[],
  locale = "zh-CN",
) {
  const merged = new Map(
    [...existing, ...additions].map((part) => [part.name, part]),
  );
  return [...merged.values()].sort((left, right) =>
    left.name.localeCompare(right.name, locale, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

export function joinManuscriptParts(parts: ManuscriptPart[]) {
  return parts.reduce((joined, part) => {
    if (!joined) return part.text;
    if (/\r?\n$/u.test(joined) || /^\r?\n/u.test(part.text))
      return joined + part.text;
    return `${joined}\n${part.text}`;
  }, "");
}
