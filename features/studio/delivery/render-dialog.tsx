"use client";

import { LoaderCircle, Play } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

import type { StudioLocale } from "../types";
import { aspectRatioValue } from "@/lib/production/image-framing";

const copy = {
  "zh-CN": {
    action: "渲染成片",
    title: "渲染成片",
    description: "使用本地 FFmpeg 导出已保存的时间线，不调用视频模型，无需渠道或模型费率。",
    ratio: "画幅",
    resolution: "分辨率",
    fps: "帧率",
    cancel: "取消",
    submit: "开始渲染",
  },
  en: {
    action: "Render video",
    title: "Render video",
    description: "Export the saved timeline locally with FFmpeg. No video model, provider credentials or model price is required.",
    ratio: "Aspect ratio",
    resolution: "Resolution",
    fps: "Frame rate",
    cancel: "Cancel",
    submit: "Start render",
  },
} as const;

export function RenderDialog({
  busy,
  defaultRatio,
  defaultResolution,
  disabled,
  locale,
  preview,
  onRender,
}: {
  busy: boolean;
  defaultRatio: string;
  defaultResolution: string;
  disabled: boolean;
  locale: StudioLocale;
  preview?: { url: string; fit: "contain" | "crop" };
  onRender: (input: {
    ratio: string;
    resolution: string;
    fps: number;
  }) => Promise<unknown>;
}) {
  const text = copy[locale];
  const [open, setOpen] = useState(false);
  const [ratio, setRatio] = useState(defaultRatio || "9:16");
  const [resolution, setResolution] = useState(defaultResolution || "1080p");
  const [fps, setFps] = useState("24");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await onRender({ ratio, resolution, fps: Number(fps) });
    if (result === false) return;
    setOpen(false);
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button disabled={disabled} size="sm" />}>
        <Play className="size-4" />
        {text.action}
      </DialogTrigger>
      <DialogContent className="min-w-0 grid-cols-1 sm:max-w-md">
        <form className="contents" onSubmit={submit}>
          <DialogHeader className="min-w-0">
            <DialogTitle>{text.title}</DialogTitle>
            <DialogDescription>{text.description}</DialogDescription>
          </DialogHeader>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label={text.ratio}
              onChange={setRatio}
              value={ratio}
              values={["9:16", "16:9", "1:1", "4:3", "3:4"]}
            />
            <SelectField
              label={text.resolution}
              onChange={setResolution}
              value={resolution}
              values={["720p", "1080p", "2160p"]}
            />
            <SelectField
              label={text.fps}
              onChange={setFps}
              value={fps}
              values={["24", "25", "30", "60"]}
            />
          </div>
          {preview && <figure className="min-w-0 space-y-1">
            <div className="mx-auto w-full min-w-0 overflow-hidden bg-black" style={{ aspectRatio: aspectRatioValue(ratio), maxWidth: Math.min(360, 224 * aspectRatioValue(ratio)) }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt={locale === "en" ? "Selected shot framing preview" : "所选镜头画幅预览"} src={preview.url} className="size-full" style={{ objectFit: preview.fit === "crop" ? "cover" : "contain" }} />
            </div>
            <figcaption className="text-xs text-muted-foreground">{locale === "en" ? "Selected shot at the export aspect ratio" : "所选镜头在导出画幅中的预览"}</figcaption>
          </figure>}
          <DialogFooter className="min-w-0">
            <Button
              disabled={busy}
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              {text.cancel}
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {text.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SelectField({
  label,
  onChange,
  value,
  values,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
  values: string[];
}) {
  return (
    <label className="grid min-w-0 grid-cols-1 gap-1.5 text-xs font-medium">
      {label}
      <NativeSelect
        className="w-full"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {values.map((item) => (
          <NativeSelectOption key={item} value={item}>
            {item}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}
