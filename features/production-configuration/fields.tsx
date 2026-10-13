"use client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ProductionCopy } from "./copy";

export const selectClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export function ConfigurationField({
  label,
  source,
  overridden,
  onInherit,
  copy,
  children,
}: {
  label: string;
  source: string;
  overridden: boolean;
  onInherit: () => void;
  copy: ProductionCopy;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {overridden ? copy.custom : `${copy.inherited} · ${source}`}
          {overridden && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-1 text-xs"
              onClick={onInherit}
            >
              {copy.inherit}
            </Button>
          )}
        </span>
      </div>
      {children}
    </div>
  );
}
