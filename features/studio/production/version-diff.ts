export type VersionFieldDifference = {
  path: string;
  before: unknown;
  after: unknown;
};

export function compareVersionPayloads(before: unknown, after: unknown): VersionFieldDifference[] {
  const differences: VersionFieldDifference[] = [];
  compareValues(before, after, "", differences, 0);
  return differences;
}

function compareValues(
  before: unknown,
  after: unknown,
  path: string,
  differences: VersionFieldDifference[],
  depth: number,
) {
  if (equalJson(before, after)) return;
  if (depth >= 6 || !isRecord(before) || !isRecord(after)) {
    differences.push({ path: path || "value", before, after });
    return;
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const key of keys) {
    const childPath = path ? `${path}.${key}` : key;
    if (!(key in before)) {
      differences.push({ path: childPath, before: undefined, after: after[key] });
    } else if (!(key in after)) {
      differences.push({ path: childPath, before: before[key], after: undefined });
    } else {
      compareValues(before[key], after[key], childPath, differences, depth + 1);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
      key === rightKeys[index] && equalJson(left[key], right[key]),
    );
  }
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((value, index) => equalJson(value, right[index]));
  return false;
}
