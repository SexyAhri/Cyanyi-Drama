"use client";

import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ConfigurationHelp({
  label,
  children,
}: {
  label: string;
  children: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 shrink-0"
            aria-label={label}
          />
        }
      >
        <Info aria-hidden="true" className="size-4" />
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="max-w-[min(20rem,calc(100vw-2rem))] whitespace-normal text-left leading-relaxed"
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
