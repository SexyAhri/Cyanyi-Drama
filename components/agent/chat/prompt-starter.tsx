"use client";

import { ArrowRight, ImagePlus, MessageSquare, Sparkles, Video } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PromptStarterProps = {
  append: (message: { role: "user"; content: string }) => void;
  description: string;
  label: string;
  suggestions: string[];
};

const starterHighlights = [
  {
    label: "Chat",
    icon: MessageSquare,
  },
  {
    label: "Image",
    icon: ImagePlus,
  },
  {
    label: "Video",
    icon: Video,
  },
];

const suggestionAccents = [
  "border-l-sky-400",
  "border-l-emerald-400",
  "border-l-violet-400",
  "border-l-amber-400",
];

export function PromptStarter({
  append,
  description,
  label,
  suggestions,
}: PromptStarterProps) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center py-8">
      <div className="grid w-full max-w-5xl gap-6">
        <div className="mx-auto grid max-w-2xl justify-items-center gap-3 text-center">
          <Badge
            className="gap-1 border-primary/20 bg-primary/10 text-primary shadow-sm shadow-primary/10"
            variant="outline"
          >
            <Sparkles className="size-3" />
            Cyanyi Drama
          </Badge>
          <div className="grid gap-2">
            <h2 className="text-3xl font-semibold tracking-normal sm:text-4xl">
              {label}
            </h2>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {starterHighlights.map((item) => {
              const Icon = item.icon;

              return (
                <span
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-card/80 px-3 text-xs text-muted-foreground shadow-sm shadow-primary/5 backdrop-blur"
                  key={item.label}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </span>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {suggestions.map((suggestion, index) => (
            <Button
              className={cn(
                "group h-auto min-h-28 items-start justify-between gap-4 rounded-xl border-l-4 bg-card/85 p-4 text-left shadow-sm shadow-primary/5 backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-card hover:shadow-md hover:shadow-primary/10",
                suggestionAccents[index % suggestionAccents.length],
              )}
              key={suggestion}
              onClick={() => append({ role: "user", content: suggestion })}
              type="button"
              variant="outline"
            >
              <span className="min-w-0 whitespace-normal text-sm leading-5 text-foreground">
                {suggestion}
              </span>
              <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
