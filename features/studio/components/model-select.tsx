"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { StudioModelOption } from "../types";

export function ModelSelect({
  ariaLabel,
  className,
  disabled,
  models,
  onChange,
  placeholder,
  value,
}: {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  models: StudioModelOption[];
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const selected = models.find((model) => model.id === value);
  return (
    <Select
      disabled={disabled || models.length === 0}
      onValueChange={(next) => next && onChange(next)}
      value={value || null}
    >
      <SelectTrigger
        aria-label={ariaLabel ?? placeholder}
        className={cn("h-9 min-w-0 w-full", className)}
      >
        <SelectValue>
          <span className="min-w-0 flex-1 truncate">
            {selected ? getStudioModelName(selected) : placeholder}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            <span className="min-w-0 flex-1 truncate">
              {getStudioModelName(model)}
            </span>
            <span className="max-w-32 shrink-0 truncate text-xs text-muted-foreground">
              {model.channelName}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function getStudioModelName(model: StudioModelOption) {
  const name = model.name.trim();
  const channelName = model.channelName.trim();
  const suffix = channelName ? ` · ${channelName}` : "";
  const deduplicated =
    suffix && name.endsWith(suffix)
      ? name.slice(0, -suffix.length).trim()
      : name;
  return deduplicated || model.modelId;
}
