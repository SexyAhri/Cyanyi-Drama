"use client";

import { cn } from "@/lib/utils";

export const AGENT_UI_LOGO_SRC = "/brand/agent-ui-logo.png";

type BrandAvatarProps = {
  alt?: string;
  className?: string;
  fallback?: string;
  size?: "default" | "lg" | "sm";
  src?: string;
};

const sizeClassName = {
  default: "size-8",
  lg: "size-10",
  sm: "size-6",
};

export function BrandAvatar({
  alt = "Agent UI",
  className,
  fallback = "AU",
  size = "sm",
  src = AGENT_UI_LOGO_SRC,
}: BrandAvatarProps) {
  return (
    <span
      aria-label={alt}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        sizeClassName[size],
        className,
      )}
      role="img"
    >
      {/* Static brand asset from public/brand; keep as a plain image to avoid Next image constraints in reusable shell components. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        className="size-full object-contain"
        onError={(event) => {
          event.currentTarget.style.display = "none";
          const fallbackNode = event.currentTarget.nextElementSibling;
          fallbackNode?.classList.remove("hidden");
        }}
        src={src}
      />
      <span className="hidden size-full items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
        {fallback}
      </span>
    </span>
  );
}
