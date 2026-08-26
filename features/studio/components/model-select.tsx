"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { StudioModelOption } from "../types";

export function ModelSelect({
  disabled,
  models,
  onChange,
  placeholder,
  value,
}: {
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
      <SelectTrigger className="h-9 w-full">
        <SelectValue>
          {selected ? `${selected.name} · ${selected.channelName}` : placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            <span className="truncate">{model.name}</span>
            <span className="text-xs text-muted-foreground">
              {model.channelName}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
