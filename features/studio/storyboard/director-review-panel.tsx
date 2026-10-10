import type { StudioLocale } from "../types";

export function DirectorReviewPanel({
  value,
  locale,
}: {
  value: unknown;
  locale: StudioLocale;
}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const findings = Array.isArray(record.findings)
    ? record.findings.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  return (
    <details className="shrink-0 border-b py-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer">
        {locale === "zh-CN"
          ? "查看当前镜头的导演审核记录"
          : "View this shot's director review"}
      </summary>
      <div className="mt-2 max-h-48 space-y-3 overflow-y-auto leading-6">
        <p>{typeof record.summary === "string" ? record.summary : ""}</p>
        {findings.map((finding, index) => (
          <div className="border-l-2 pl-3" key={index}>
            <p className="font-medium text-foreground">
              {typeof finding.location === "string" ? finding.location : ""} ·{" "}
              {typeof finding.issue === "string" ? finding.issue : ""}
            </p>
            <p>
              {typeof finding.suggestion === "string" ? finding.suggestion : ""}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}
