"use client";

import { Languages } from "lucide-react";

import { AuthAccountMenu } from "@/components/auth/account-menu";
import {
  ProductBrand,
  ProductNavigation,
} from "@/components/navigation/product-navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AuthUser } from "@/lib/server/auth";

import { getStudioCopy } from "../i18n";
import type { StudioLocale } from "../types";

export function StudioAppHeader({
  locale,
  onLocaleChange,
  user,
}: {
  locale: StudioLocale;
  onLocaleChange: () => void;
  user: AuthUser;
}) {
  const copy = getStudioCopy(locale);

  return (
    <header className="flex h-14 shrink-0 items-center border-b bg-background/95 px-4 backdrop-blur-sm sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 sm:gap-5">
        <ProductBrand />
        <ProductNavigation isAdmin={user.role === "ADMIN"} locale={locale} />

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle label={copy.theme} />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={copy.language}
                  onClick={onLocaleChange}
                  size="icon"
                  type="button"
                  variant="ghost"
                />
              }
            >
              <Languages className="size-4" />
            </TooltipTrigger>
            <TooltipContent>{copy.language}</TooltipContent>
          </Tooltip>
          <AuthAccountMenu locale={locale} user={user} />
        </div>
      </div>
    </header>
  );
}
