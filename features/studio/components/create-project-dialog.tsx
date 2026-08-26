"use client";

import { FormEvent, useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";

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

import { getStudioCopy } from "../i18n";
import type { StudioLocale } from "../types";

export function CreateProjectDialog({
  createProject,
  locale,
}: {
  createProject: (input: {
    name: string;
    description?: string;
  }) => Promise<{ id: string }>;
  locale: StudioLocale;
}) {
  const copy = getStudioCopy(locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const project = await createProject({
        name: normalizedName,
        description: description.trim() || undefined,
      });
      setOpen(false);
      router.push(`/projects/${encodeURIComponent(project.id)}`);
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
      <DialogTrigger render={<Button size="lg" />}>
        <Plus className="size-4" />
        {copy.newProject}
      </DialogTrigger>
      <DialogContent className="rounded-lg sm:max-w-md">
        <form className="contents" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{copy.createProject}</DialogTitle>
            <DialogDescription className="sr-only">
              {copy.createProject}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1">
            <label className="grid gap-1.5 text-sm font-medium">
              {copy.projectName}
              <Input
                autoFocus
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                placeholder={copy.projectNamePlaceholder}
                value={name}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {copy.projectDescription}
              <Textarea
                className="min-h-24 resize-none"
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={copy.projectDescriptionPlaceholder}
                value={description}
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
                <Plus className="size-4" />
              )}
              {isSubmitting ? copy.creating : copy.createProject}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
