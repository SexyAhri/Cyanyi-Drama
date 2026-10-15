import { Button } from "@/components/ui/button";
import type { ProjectAssetCatalog, StudioLocale } from "../types";
import type { CanvasCard, CanvasDocument } from "./types";
import { canvasAssetPromptDifference } from "./canvas-production-sync";

export function CanvasPromptDifference({
  node,
  document,
  catalog,
  locale,
  busy,
  onPatch,
}: {
  node: CanvasCard;
  document: CanvasDocument;
  catalog?: ProjectAssetCatalog;
  locale: StudioLocale;
  busy: boolean;
  onPatch: (patch: Partial<CanvasCard>) => void;
}) {
  const difference = canvasAssetPromptDifference(node, document, catalog);
  if (!difference) return null;
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  return (
    <details className="rounded-md border p-2.5">
      <summary className="cursor-pointer font-medium">
        {difference.officialChanged
          ? t("正式设定已变化，草稿已保留", "Settings changed; draft preserved")
          : t("草稿与正式设定不同", "Draft differs from project settings")}
      </summary>
      <div className="mt-3 space-y-3">
        {!node.assetPromptBase && (
          <p className="text-muted-foreground">
            {t(
              "旧节点没有模板基线，无法判断是否手改，因此不会自动覆盖。",
              "This legacy node has no template baseline. Its text will not be overwritten automatically.",
            )}
          </p>
        )}
        <div>
          <h4 className="font-medium">{t("当前草稿", "Current draft")}</h4>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words leading-6">
            {node.text || t("空", "Empty")}
          </p>
        </div>
        <div>
          <h4 className="font-medium">
            {t("最新正式设定", "Latest project settings")}
          </h4>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words leading-6">
            {difference.currentPrompt}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-auto min-h-8 whitespace-normal"
          disabled={busy}
          onClick={() =>
            onPatch({
              text: difference.currentPrompt,
              assetPromptBase: {
                entityId: difference.entityId,
                prompt: difference.currentPrompt,
              },
            })
          }
        >
          {t("将草稿替换为最新设定", "Replace draft with latest settings")}
        </Button>
      </div>
    </details>
  );
}
