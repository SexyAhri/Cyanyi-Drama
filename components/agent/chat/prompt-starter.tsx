"use client";

import { ArrowRight, Clapperboard, ImagePlus, Video } from "lucide-react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { AgentComposerMode } from "../composer";
import type { ShellCopy } from "../shell";

type PromptStarterProps = {
  copy: ShellCopy;
  onModeSelect: (mode: AgentComposerMode) => void;
  onPromptSelect: (prompt: string) => void;
  suggestions: string[];
};

export function PromptStarter({
  copy,
  onModeSelect,
  onPromptSelect,
  suggestions,
}: PromptStarterProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center gap-7 py-6">
        <div className="grid max-w-2xl gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Cyanyi Drama
          </p>
          <h1 className="text-2xl font-semibold sm:text-3xl">
            {copy.promptStarterTitle}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {copy.promptStarterDescription}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Link
            className={cn(
              buttonVariants({ variant: "outline" }),
              "group h-auto min-h-20 items-center justify-start gap-3 rounded-lg p-3 text-left",
            )}
            href="/projects"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Clapperboard className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {copy.dramaStudio}
              </span>
              <span className="mt-0.5 block whitespace-normal text-xs leading-4 text-muted-foreground">
                {copy.promptStarterProjectDescription}
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
          <StarterAction
            description={copy.promptStarterImageDescription}
            icon={ImagePlus}
            label={copy.promptStarterImage}
            onClick={() => onModeSelect("image")}
          />
          <StarterAction
            description={copy.promptStarterVideoDescription}
            icon={Video}
            label={copy.promptStarterVideo}
            onClick={() => onModeSelect("video")}
          />
        </div>

        <section className="grid gap-2">
          <h2 className="text-sm font-medium">{copy.promptSuggestionsLabel}</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {suggestions.map((suggestion) => (
              <Button
                className="group h-auto min-h-16 items-start justify-between gap-3 rounded-lg p-3 text-left"
                key={suggestion}
                onClick={() => onPromptSelect(suggestion)}
                type="button"
                variant="ghost"
              >
                <span className="min-w-0 whitespace-normal text-sm leading-5">
                  {suggestion}
                </span>
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              </Button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function StarterAction({
  description,
  icon: Icon,
  label,
  onClick,
}: {
  description: string;
  icon: typeof ImagePlus;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className="group h-auto min-h-20 items-center justify-start gap-3 rounded-lg p-3 text-left"
      onClick={onClick}
      type="button"
      variant="outline"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block whitespace-normal text-xs leading-4 text-muted-foreground">
          {description}
        </span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
    </Button>
  );
}
