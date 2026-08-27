"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useRef, useState } from "react";

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
import { Input } from "@/components/ui/input";
import {
  SuggestedInput,
  type SuggestedInputOption,
} from "@/components/ui/suggested-input";
import { Textarea } from "@/components/ui/textarea";

import type { StudioLocale } from "../types";

const copy = {
  "zh-CN": {
    add: "新增音色",
    title: "新增音色",
    description: "保存项目可复用的声音配置。",
    name: "音色名称",
    namePlaceholder: "例如：旁白",
    voice: "声音标识（可选）",
    voicePlaceholder: "留空时使用语音模型默认音色",
    voiceSuggestions: "常用音色",
    language: "语言",
    languagePlaceholder: "例如：zh-CN",
    sample: "参考音频",
    notes: "备注",
    notesPlaceholder: "可选",
    cancel: "取消",
    create: "创建音色",
  },
  en: {
    add: "Add voice",
    title: "Add voice",
    description: "Save a reusable voice configuration for this project.",
    name: "Voice name",
    namePlaceholder: "For example, Narrator",
    voice: "Voice identifier (optional)",
    voicePlaceholder: "Leave empty to use the speech model default",
    voiceSuggestions: "Common voices",
    language: "Language",
    languagePlaceholder: "For example, en-US",
    sample: "Reference audio",
    notes: "Notes",
    notesPlaceholder: "Optional",
    cancel: "Cancel",
    create: "Create voice",
  },
} as const;

export function VoicePresetDialog({
  locale,
  onCreate,
}: {
  locale: StudioLocale;
  onCreate: (input: {
    name: string;
    providerVoiceId?: string;
    language?: string;
    description?: string;
    sample?: File;
  }) => Promise<unknown>;
}) {
  const text = copy[locale];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [voice, setVoice] = useState("");
  const [language, setLanguage] = useState("");
  const [description, setDescription] = useState("");
  const [sample, setSample] = useState<File>();
  const [busy, setBusy] = useState(false);
  const sampleInputRef = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate({
        name: name.trim(),
        providerVoiceId: voice.trim() || undefined,
        language: language.trim() || undefined,
        description: description.trim() || undefined,
        sample,
      });
      setName("");
      setVoice("");
      setLanguage("");
      setDescription("");
      setSample(undefined);
      if (sampleInputRef.current) sampleInputRef.current.value = "";
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Plus className="size-4" />
        {text.add}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form className="contents" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{text.title}</DialogTitle>
            <DialogDescription>{text.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label={text.name}>
              <Input
                autoFocus
                onChange={(event) => setName(event.target.value)}
                placeholder={text.namePlaceholder}
                value={name}
              />
            </Field>
            <Field label={text.voice}>
              <SuggestedInput
                ariaLabel={text.voice}
                onChange={setVoice}
                options={commonVoiceOptions(locale)}
                placeholder={text.voicePlaceholder}
                suggestionsLabel={text.voiceSuggestions}
                value={voice}
              />
            </Field>
            <Field label={text.language}>
              <Input
                onChange={(event) => setLanguage(event.target.value)}
                placeholder={text.languagePlaceholder}
                value={language}
              />
            </Field>
            <Field label={text.sample}>
              <Input
                accept="audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm,audio/flac"
                onChange={(event) => setSample(event.target.files?.[0])}
                ref={sampleInputRef}
                type="file"
              />
            </Field>
            <Field label={text.notes}>
              <Textarea
                onChange={(event) => setDescription(event.target.value)}
                placeholder={text.notesPlaceholder}
                value={description}
              />
            </Field>
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
            <Button disabled={busy || !name.trim()} type="submit">
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {text.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function commonVoiceOptions(locale: StudioLocale): SuggestedInputOption[] {
  const values = [
    ["alloy", "均衡自然", "Balanced and natural"],
    ["ash", "沉稳清晰", "Calm and clear"],
    ["ballad", "温暖叙事", "Warm and narrative"],
    ["coral", "明亮亲切", "Bright and friendly"],
    ["echo", "平稳有力", "Steady and strong"],
    ["fable", "富有表现力", "Expressive and lively"],
    ["nova", "清亮自然", "Clear and natural"],
    ["onyx", "低沉厚重", "Deep and weighty"],
    ["sage", "成熟克制", "Mature and restrained"],
    ["shimmer", "柔和细腻", "Soft and nuanced"],
    ["verse", "自然对话感", "Conversational and natural"],
  ] as const;
  return values.map(([value, zh, en]) => ({
    value,
    description: locale === "en" ? en : zh,
  }));
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}
      {children}
    </label>
  );
}
