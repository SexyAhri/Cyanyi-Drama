"use client";

import { Check, ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SuggestedInputOption = {
  description?: string;
  value: string;
};

export function SuggestedInput({
  ariaLabel,
  className,
  disabled = false,
  maxLength,
  onChange,
  options,
  placeholder,
  suggestionsLabel,
  value,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  maxLength?: number;
  onChange: (value: string) => void;
  options: SuggestedInputOption[];
  placeholder?: string;
  suggestionsLabel?: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <InputGroup className={className}>
        <InputGroupInput
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          role="combobox"
          value={value}
        />
        <InputGroupAddon align="inline-end">
          <PopoverTrigger
            render={
              <InputGroupButton
                aria-label={suggestionsLabel ?? ariaLabel}
                disabled={disabled}
                size="icon-xs"
              />
            }
          >
            <ChevronDown className="size-3.5" />
          </PopoverTrigger>
        </InputGroupAddon>
      </InputGroup>
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-1"
        sideOffset={6}
      >
        <PopoverHeader className="sr-only">
          <PopoverTitle>{suggestionsLabel ?? ariaLabel}</PopoverTitle>
        </PopoverHeader>
        <div className="max-h-72 overflow-y-auto" id={listId} role="listbox">
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                aria-selected={selected}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted",
                  selected && "bg-muted",
                )}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {option.value}
                  </span>
                  {option.description ? (
                    <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
                <Check
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    selected ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
