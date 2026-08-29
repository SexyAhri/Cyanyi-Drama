"use client";

import { useState } from "react";
import { ChevronDown, LoaderCircle, LogOut, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
import type { AuthUser } from "@/lib/server/auth";

export function AuthAccountMenu({
  compact = false,
  locale,
  user,
}: {
  compact?: boolean;
  locale: "en" | "zh-CN";
  user: AuthUser;
}) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const copy =
    locale === "zh-CN"
      ? { account: "当前账号", logout: "退出登录", failed: "退出登录失败" }
      : {
          account: "Current account",
          logout: "Log out",
          failed: "Failed to log out",
        };

  async function logout() {
    setLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(copy.failed);
      router.replace("/login");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.failed);
      setLoggingOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={copy.account}
            className={cn("h-8 gap-1.5 px-2", !compact && "max-w-48")}
            size={compact ? "icon-sm" : "sm"}
            type="button"
            variant="ghost"
          />
        }
      >
        {loggingOut ? <LoaderCircle className="animate-spin" /> : <UserRound />}
        {!compact ? (
          <>
            <span className="max-w-32 truncate">{user.displayName}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{copy.account}</DropdownMenuLabel>
          <DropdownMenuLabel className="grid gap-0.5 font-normal">
            <span className="truncate text-sm font-medium">
              {user.displayName}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {user.email}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={loggingOut} onClick={() => void logout()}>
          {loggingOut ? <LoaderCircle className="animate-spin" /> : <LogOut />}
          <span>{copy.logout}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
