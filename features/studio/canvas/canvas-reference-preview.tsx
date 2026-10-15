"use client";
import { useState } from "react";
import { MediaPreviewDialog } from "@/components/ui/media-preview-dialog";
import type { ProjectAssetCatalog, StudioLocale } from "../types";

export type CanvasReviewReference = {
  assetId?: string;
  url?: string;
  role?: string;
};
export function canvasReviewReferences(
  value: unknown,
): CanvasReviewReference[] | undefined {
  if (!Array.isArray(value)) return;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const reference = item as Record<string, unknown>;
    const assetId =
      typeof reference.assetId === "string" ? reference.assetId : undefined;
    const url = typeof reference.url === "string" ? reference.url : undefined;
    if (!assetId && !url) return [];
    return [
      {
        assetId,
        url,
        role: typeof reference.role === "string" ? reference.role : undefined,
      },
    ];
  });
}

export function CanvasReferencePreview({
  references,
  catalog,
  locale,
}: {
  references?: CanvasReviewReference[];
  catalog?: ProjectAssetCatalog;
  locale: StudioLocale;
}) {
  const [preview, setPreview] = useState<{ title: string; url: string }>();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  return (
    <div className="mt-3 space-y-2 text-xs">
      <p className="font-medium">
        {t("实际模型图片参考", "Actual model image references")}
        {references ? ` · ${references.length}` : ""}
      </p>
      {references === undefined ? (
        <p className="text-muted-foreground">
          {t(
            "此预览未返回素材明细，请查看实际提示词与请求参数。",
            "This preview did not return media details. Review the actual prompt and request parameters.",
          )}
        </p>
      ) : !references.length ? (
        <p className="text-muted-foreground">
          {t("本次请求没有图片参考。", "This request has no image references.")}
        </p>
      ) : (
        <ul className="space-y-2">
          {references.map((reference, index) => {
            const asset = catalog?.assets.find(
              (item) => item.id === reference.assetId,
            );
            const url = reference.url || asset?.url;
            const role =
              reference.role === "first_frame"
                ? t("首帧", "First frame")
                : reference.role === "last_frame"
                  ? t("尾帧", "Last frame")
                  : t("形象参考", "Visual reference");
            const title = `${index + 1} · ${role}`;
            return (
              <li
                key={`${reference.assetId ?? reference.url}-${reference.role}-${index}`}
                className="flex min-w-0 items-start gap-3 rounded-md border p-2"
              >
                {url && (
                  <button
                    type="button"
                    className="h-14 w-20 shrink-0 overflow-hidden rounded border focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={`${t("预览", "Preview")} ${title}`}
                    onClick={() => setPreview({ title, url })}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={title}
                      className="h-full w-full object-contain"
                    />
                  </button>
                )}
                <div className="min-w-0 space-y-1">
                  <p>{title}</p>
                  <p className="break-all text-muted-foreground">
                    {t("素材版本：", "Media version: ")}
                    {reference.assetId ?? t("外部参考", "External reference")}
                  </p>
                  {asset?.createdAt && (
                    <p className="text-muted-foreground">
                      {new Date(asset.createdAt).toLocaleString(
                        locale === "en" ? "en-US" : "zh-CN",
                      )}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {preview && (
        <MediaPreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) setPreview(undefined);
          }}
          title={preview.title}
          description={preview.title}
          alt={preview.title}
          kind="image"
          url={preview.url}
        />
      )}
    </div>
  );
}
