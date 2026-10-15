export type UsageRecord = {
  id: string;
  createdAt: string;
  model: string;
  apiType: string;
  action: string;
  quantity: number;
  unit: string;
  cost: string;
  user: { id: string; displayName: string };
  project: { id: string; name: string } | null;
  tokens: UsageTokens;
};

export type UsageTokens = {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
};

export type UsageRecordsPage = {
  costs: UsageRecord[];
  filters: { apiTypes: string[] };
  summary: { count: number; cost: string };
  page: number;
  pageSize: number;
  asOf: string;
};

/** Only provider-reported actual usage is evidence; reservations and total quantity are not. */
export function recordedUsageTokens(
  metadata: string | null | undefined,
): UsageTokens {
  const empty: UsageTokens = {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
  };
  if (!metadata) return empty;
  try {
    const usage = JSON.parse(metadata)?.actualUsage;
    if (!usage || typeof usage !== "object") return empty;
    const count = (value: unknown): number | null =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? value
        : null;
    const input = count(usage.inputTokens);
    const output = count(usage.outputTokens);
    let cacheRead = count(usage.cachedInputTokens);
    let cacheWrite = count(usage.cacheWriteTokens);
    if (input !== null && (cacheRead ?? 0) + (cacheWrite ?? 0) > input) {
      cacheRead = null;
      cacheWrite = null;
    }
    return { input, output, cacheRead, cacheWrite };
  } catch {
    return empty;
  }
}

export function formatUsageTime(
  value: string,
  locale: "zh-CN" | "en" = "zh-CN",
  timeZone?: string,
) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);
}
