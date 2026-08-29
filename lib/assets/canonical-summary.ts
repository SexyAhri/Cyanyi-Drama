const PLACEHOLDER_VALUE =
  /^(?:无|无具体描述|没有具体描述|未具体描述|原文未描述|原文未提及|未描述|未提及|未说明|未知|暂无|不详|null|none|unknown|not\s+(?:specified|described|mentioned)|n\/?a)$/iu;

const FACT_LABEL =
  /^(?:空间尺度|地貌层级|地貌|建筑关系|建筑|天地能量\/?科技规律|天地能量规律|科技规律|环境要素|静态概述|静态描述|概述|描述|材质|结构|工艺|用途)\s*(?:为|是|[:：])?\s*/u;

export function canonicalSummaryPlaceholderFragments(
  value: string | null | undefined,
) {
  return summaryFragments(value).filter((fragment) =>
    PLACEHOLDER_VALUE.test(fragment.replace(FACT_LABEL, "").trim()),
  );
}

export function sanitizeCanonicalSummary(
  value: string | null | undefined,
) {
  const facts = summaryFragments(value).filter(
    (fragment) =>
      !PLACEHOLDER_VALUE.test(fragment.replace(FACT_LABEL, "").trim()),
  );
  return facts.length ? deduplicateFacts(facts).join("；") : null;
}

export function mergeCanonicalSummary(
  existing: string | null | undefined,
  incoming: string | null | undefined,
) {
  const existingFacts = summaryFragments(sanitizeCanonicalSummary(existing));
  const incomingFacts = summaryFragments(sanitizeCanonicalSummary(incoming));
  const merged = deduplicateFacts([...existingFacts, ...incomingFacts]);
  return merged.length ? merged.join("；") : null;
}

function summaryFragments(value: string | null | undefined) {
  return (value ?? "")
    .split(/[，,；;。\n]+/u)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
}

function deduplicateFacts(facts: string[]) {
  const result: string[] = [];
  for (const fact of facts) {
    const key = factKey(fact);
    if (!key) continue;
    const duplicateIndex = result.findIndex((current) => {
      const currentKey = factKey(current);
      return (
        currentKey === key ||
        (currentKey.length >= 8 && key.includes(currentKey)) ||
        (key.length >= 8 && currentKey.includes(key))
      );
    });
    if (duplicateIndex < 0) result.push(fact);
    else if (fact.length > result[duplicateIndex].length)
      result[duplicateIndex] = fact;
  }
  return result;
}

function factKey(value: string) {
  return value.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
}
