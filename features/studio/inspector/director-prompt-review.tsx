import { CheckCheck } from "lucide-react";
import type { StudioLocale } from "../types";

export function DirectorPromptReview({
  value,
  locale,
  completed = false,
}: {
  value: unknown;
  locale: StudioLocale;
  completed?: boolean;
}) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const before = typeof record.before === "string" ? record.before : "";
  const after = typeof record.after === "string" ? record.after : "";
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  if (!after) return null;
  return (
    <div className="space-y-3 text-xs">
      {completed && (
        <p className="flex items-start gap-2 leading-5 text-muted-foreground">
          <CheckCheck className="mt-0.5 size-3.5 shrink-0" />
          {t(
            "草稿已更新，可回到画布审核生成。",
            "Draft updated. Review it in the canvas before generating.",
          )}
        </p>
      )}
      {!completed && (
        <details className="rounded-lg border px-3 py-2">
          <summary className="cursor-pointer text-muted-foreground">
            {t("修改前", "Previous prompt")}
          </summary>
          <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-anywhere leading-6">
            {before || t("尚未填写", "Empty")}
          </p>
        </details>
      )}
      <section className="rounded-lg bg-muted/40 px-3 py-2.5">
        <h4 className="mb-2 font-medium">
          {completed
            ? t("当前草稿", "Current draft")
            : t("建议草稿", "Proposed draft")}
        </h4>
        <p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-anywhere leading-6">
          {after}
        </p>
      </section>
    </div>
  );
}
