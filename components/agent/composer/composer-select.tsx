"use client";

import { Check, ChevronDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { AgentComposerOption } from "./types";

type ComposerSelectProps = {
  active?: boolean;
  className?: string;
  label?: string;
  onClear?: () => void;
  onValueChange: (value: string) => void;
  options: AgentComposerOption[];
  value: string;
};

export function ComposerSelect({
  active,
  className,
  label,
  onClear,
  onValueChange,
  options,
  value,
}: ComposerSelectProps) {
  const selected = options.find((option) => option.id === value) ?? options[0];
  const Icon = selected?.icon;
  const isRatioSelect = options.every((option) => /^\d+:\d+$/.test(option.id));

  if (!selected) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className={cn(
              "h-8 gap-1 rounded-lg px-2 text-sm",
              active &&
                "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
              className,
            )}
            type="button"
            variant={active ? "secondary" : "ghost"}
          >
            {isRatioSelect ? (
              <RatioIcon ratio={selected.id} />
            ) : Icon ? (
              <Icon />
            ) : null}
            <span>{selected.label}</span>
            {onClear ? (
              <span
                aria-label="Clear mode"
                className="ml-0.5 rounded-sm p-0.5 hover:bg-primary/10"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onClear();
                }}
                role="button"
                tabIndex={0}
              >
                <X className="size-3" />
              </span>
            ) : (
              <ChevronDown className="size-3.5 text-muted-foreground" />
            )}
          </Button>
        }
      />
      <DropdownMenuContent
        align="start"
        className={cn(
          isRatioSelect
            ? "w-72 p-2"
            : "w-80 max-w-[calc(100vw-1rem)]",
        )}
      >
        <DropdownMenuGroup>
          {label ? <DropdownMenuLabel>{label}</DropdownMenuLabel> : null}
          {label ? <DropdownMenuSeparator /> : null}
          {isRatioSelect ? (
            <div className="grid grid-cols-4 gap-2 p-1">
              {options.map((option) => (
                <DropdownMenuItem
                  className={cn(
                    "relative flex h-16 cursor-default flex-col items-center justify-center gap-1 rounded-xl border bg-background p-1 text-xs transition-colors focus:bg-accent focus:text-accent-foreground",
                    option.id === value &&
                      "border-primary bg-primary/10 text-primary",
                  )}
                  key={option.id}
                  onClick={() => onValueChange(option.id)}
                >
                  <RatioIcon ratio={option.id} />
                  <span>{option.label}</span>
                  {option.id === value ? (
                    <Check className="absolute right-2 top-2 size-3" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </div>
          ) : (
            options.map((option) => {
              const OptionIcon = option.icon;

              return (
                <DropdownMenuItem
                  key={option.id}
                  onClick={() => onValueChange(option.id)}
                >
                  {OptionIcon ? <OptionIcon /> : null}
                  <span className="min-w-0 whitespace-nowrap">
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className="ml-1 truncate text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RatioIcon({ ratio }: { ratio: string }) {
  const [widthRatio, heightRatio] = ratio.split(":").map(Number);
  const isPortrait = heightRatio > widthRatio;
  const isLandscape = widthRatio > heightRatio;

  return (
    <span
      className={cn(
        "inline-block rounded-[3px] border border-current",
        isPortrait && "h-4 w-2.5",
        isLandscape && "h-2.5 w-4",
        !isPortrait && !isLandscape && "size-3.5",
      )}
    />
  );
}
