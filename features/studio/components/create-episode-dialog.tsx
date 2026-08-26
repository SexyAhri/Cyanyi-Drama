"use client";

import { FormEvent, useState } from "react";
import { FilePlus2, LoaderCircle } from "lucide-react";

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
import type { EpisodeRecord } from "@/lib/projects/types";

import { getStudioCopy } from "../i18n";
import type { StudioLocale } from "../types";

export function CreateEpisodeDialog({
  createEpisode,
  locale,
  onCreated,
  trigger,
}: {
  createEpisode: (input: {
    name: string;
    novelText?: string;
  }) => Promise<EpisodeRecord>;
  locale: StudioLocale;
  onCreated: (episode: EpisodeRecord) => void;
  trigger?: React.ReactElement;
}) {
  const copy = getStudioCopy(locale);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [novelText, setNovelText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const episode = await createEpisode({
        name: name.trim(),
        novelText: novelText.trim() || undefined,
      });
      setOpen(false);
      setName("");
      setNovelText("");
      onCreated(episode);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : copy.loadFailed,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      {trigger ? (
        <DialogTrigger render={trigger} />
      ) : (
        <DialogTrigger
          render={
            <Button
              aria-label={copy.addEpisode}
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <FilePlus2 className="size-4" />
        </DialogTrigger>
      )}
      <DialogContent className="rounded-lg sm:max-w-lg">
        <form className="contents" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{copy.createEpisode}</DialogTitle>
            <DialogDescription className="sr-only">
              {copy.createEpisode}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <label className="grid gap-1.5 text-sm font-medium">
              {copy.episodeName}
              <Input
                autoFocus
                maxLength={160}
                onChange={(event) => setName(event.target.value)}
                placeholder={copy.episodeNamePlaceholder}
                value={name}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {copy.novelText}
              <Textarea
                className="min-h-40 resize-y"
                onChange={(event) => setNovelText(event.target.value)}
                placeholder={copy.novelTextPlaceholder}
                value={novelText}
              />
            </label>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter className="rounded-b-lg">
            <Button
              disabled={isSubmitting}
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              {copy.cancel}
            </Button>
            <Button disabled={!name.trim() || isSubmitting} type="submit">
              {isSubmitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <FilePlus2 className="size-4" />
              )}
              {isSubmitting ? copy.creating : copy.createEpisode}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
