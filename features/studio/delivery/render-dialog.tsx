"use client";

import { LoaderCircle, Play } from "lucide-react";
import { useEffect, useState } from "react";

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

import { ModelSelect } from "../components/model-select";
import type { StudioLocale, StudioModelOption } from "../types";

const copy = {
  "zh-CN": {
    action: "渲染成片",
    title: "渲染成片",
    description: "确认输出规格并提交当前时间线。",
    model: "渲染模型",
    ratio: "画幅",
    resolution: "分辨率",
    fps: "帧率",
    cancel: "取消",
    submit: "开始渲染",
  },
  en: {
    action: "Render video",
    title: "Render video",
    description: "Confirm the output settings and submit the current timeline.",
    model: "Render model",
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
  models,
  onRender,
}: {
  busy: boolean;
  defaultRatio: string;
  defaultResolution: string;
  disabled: boolean;
  locale: StudioLocale;
  models: StudioModelOption[];
  onRender: (input: {
    model: StudioModelOption;
    ratio: string;
    resolution: string;
    fps: number;
  }) => Promise<unknown>;
}) {
  const text = copy[locale];
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  const [ratio, setRatio] = useState(defaultRatio || "9:16");
  const [resolution, setResolution] = useState(defaultResolution || "1080p");
  const [fps, setFps] = useState("24");

  useEffect(() => {
    setModelId((current) =>
      models.some((model) => model.id === current)
        ? current
        : (models[0]?.id ?? ""),
    );
  }, [models]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const model = models.find((item) => item.id === modelId);
    if (!model) return;
    await onRender({ model, ratio, resolution, fps: Number(fps) });
    setOpen(false);
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button disabled={disabled} size="sm" />}>
        <Play className="size-4" />
        {text.action}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form className="contents" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{text.title}</DialogTitle>
            <DialogDescription>{text.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-medium sm:col-span-2">
              {text.model}
              <ModelSelect
                disabled={busy}
                models={models}
                onChange={setModelId}
                placeholder={text.model}
                value={modelId}
              />
            </label>
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
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              {text.cancel}
            </Button>
            <Button disabled={busy || !modelId} type="submit">
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
    <label className="grid gap-1.5 text-xs font-medium">
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
