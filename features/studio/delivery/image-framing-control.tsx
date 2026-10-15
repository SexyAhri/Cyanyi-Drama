"use client";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  imageAspectAssessment,
  type ImageFit,
} from "@/lib/production/image-framing";
import type { StudioLocale } from "../types";

export function ImageFramingControl({
  metadata,
  ratio,
  value,
  locale,
  onChange,
}: {
  metadata: Record<string, unknown>;
  ratio: string;
  value: ImageFit;
  locale: StudioLocale;
  onChange: (value: ImageFit) => void;
}) {
  const inspection = imageAspectAssessment(metadata, ratio);
  return (
    <div className="mt-2 grid gap-1.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p
          className={
            inspection.mismatch ? "text-status-warning" : "text-muted-foreground"
          }
        >
          {inspection.measured
            ? `${inspection.width} × ${inspection.height} · ${locale === "en" ? "Output" : "成片"} ${ratio}`
            : locale === "en"
              ? "Actual dimensions have not been measured yet."
              : "尚未取得实际图片尺寸。"}
          {inspection.mismatch
            ? locale === "en"
              ? " — Aspect ratio differs. Review framing before export."
              : " — 画幅不一致，请预览处理方式后导出。"
            : ""}
        </p>
        <label className="flex w-full min-w-0 items-center gap-2 font-medium sm:w-auto sm:max-w-80 sm:min-w-60 sm:flex-1">
          <span className="shrink-0">{locale === "en" ? "Framing" : "画幅处理"}</span>
          <NativeSelect
            aria-label={locale === "en" ? "Image framing (saved with timeline)" : "图片画幅处理（随时间线保存）"}
            size="sm"
            value={value}
            onChange={(event) =>
              onChange(event.target.value === "crop" ? "crop" : "contain")
            }
          >
            <NativeSelectOption value="contain">
              {locale === "en"
                ? "Fit entire image with black bars"
                : "完整保留 · 黑色填边"}
            </NativeSelectOption>
            <NativeSelectOption value="crop">
              {locale === "en"
                ? "Crop center to fill frame"
                : "居中裁切 · 填满画面"}
            </NativeSelectOption>
          </NativeSelect>
        </label>
      </div>
      {inspection.mismatch && (
        <p className="text-muted-foreground">
          {locale === "en"
            ? "To regenerate at the target ratio, return to this shot in Storyboard. The original image is preserved."
            : "如需按目标画幅重新生成，请回到分镜处理该镜头。原图会保留。"}
        </p>
      )}
    </div>
  );
}
