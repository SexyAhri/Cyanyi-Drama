/** Valid JSON at every budget level. Truncation is explicit; never cut serialized JSON. */
export function serializeBudgetedContext(value: unknown, maxChars = 32_000) {
  function compact(
    item: unknown,
    stringLimit: number,
    arrayLimit: number,
    depth = 0,
  ): unknown {
    if (depth > 16) return { truncated: true, reason: "context_depth" };
    if (typeof item === "string")
      return item.length <= stringLimit
        ? item
        : `${item.slice(0, stringLimit)}\n[内容已截取，需按对象读取更多资料]`;
    if (Array.isArray(item)) {
      const result = item
        .slice(0, arrayLimit)
        .map((entry) => compact(entry, stringLimit, arrayLimit, depth + 1));
      if (item.length > arrayLimit)
        result.push({ truncated: true, totalItems: item.length });
      return result;
    }
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([key, entry]) => [
          key,
          compact(entry, stringLimit, arrayLimit, depth + 1),
        ]),
      );
    return item;
  }
  for (const [strings, arrays] of [
    [6000, 60],
    [2400, 30],
    [800, 15],
    [250, 6],
    [100, 2],
  ]) {
    const compacted = compact(value, strings, arrays);
    const text = JSON.stringify({
      ...(compacted && typeof compacted === "object" && !Array.isArray(compacted) ? compacted : { data: compacted }),
      contextBudget: { maxChars, excerptsOnly: true },
    });
    if (text.length <= maxChars) return text;
  }
  throw new Error("导演上下文超过预算，请选择具体剧集或对象后重试");
}
