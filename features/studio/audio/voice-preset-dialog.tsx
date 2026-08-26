"use client";

import { LoaderCircle, Plus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type { StudioLocale } from "../types";

const copy = {
  "zh-CN": {
    add: "新增音色",
    title: "新增音色",
    description: "保存项目可复用的声音配置。",
    name: "音色名称",
    namePlaceholder: "例如：旁白",
    voice: "声音标识",
    voicePlaceholder: "渠道支持的声音名称",
    language: "语言",
    languagePlaceholder: "例如：zh-CN",
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
    voice: "Voice identifier",
    voicePlaceholder: "A voice supported by the channel",
    language: "Language",
    languagePlaceholder: "For example, en-US",
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
  }) => Promise<unknown>;
}) {
  const text = copy[locale];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [voice, setVoice] = useState("");
  const [language, setLanguage] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

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
      });
      setName("");
      setVoice("");
      setLanguage("");
      setDescription("");
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
              <Input
                onChange={(event) => setVoice(event.target.value)}
                placeholder={text.voicePlaceholder}
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
