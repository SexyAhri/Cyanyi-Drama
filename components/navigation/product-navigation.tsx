"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Clapperboard, PanelsTopLeft, SlidersHorizontal } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type ProductNavigationProps = {
  compact?: boolean;
  isAdmin?: boolean;
  locale: "en" | "zh-CN";
};

const navigation = [
  { id: "projects", href: "/projects", icon: Clapperboard },
  { id: "chat", href: "/chat", icon: Bot },
  { id: "admin", href: "/admin/channels", icon: SlidersHorizontal, admin: true },
] as const;

export function ProductBrand({
  className,
  href = "/projects",
}: {
  className?: string;
  href?: string;
}) {
  return (
    <Link
      className={cn("flex min-w-0 shrink-0 items-center gap-2 font-semibold", className)}
      href={href}
    >
      <Image
        alt="Cyanyi Drama"
        className="size-7 rounded-md"
        height={28}
        priority
        src="/brand/agent-ui-logo.png"
        width={28}
      />
      <span className="hidden truncate text-sm sm:inline">Cyanyi Drama</span>
    </Link>
  );
}

export function ProductNavigation({
  compact = false,
  isAdmin = false,
  locale,
}: ProductNavigationProps) {
  const pathname = usePathname();
  const copy = getNavigationCopy(locale);
  const items = navigation.filter(
    (item) => !("admin" in item && item.admin) || isAdmin,
  );

  return (
    <>
      {!compact ? (
        <nav aria-label={copy.navigation} className="hidden items-center gap-1 lg:flex">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isNavigationActive(pathname, item.id);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={buttonVariants({
                  size: "sm",
                  variant: active ? "secondary" : "ghost",
                })}
                href={item.href}
                key={item.id}
              >
                <Icon className="size-4" />
                {copy[item.id]}
              </Link>
            );
          })}
        </nav>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={copy.switchWorkspace}
              className={compact ? undefined : "lg:hidden"}
              size="icon-sm"
              title={copy.switchWorkspace}
              type="button"
              variant="ghost"
            />
          }
        >
          <PanelsTopLeft />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{copy.workspace}</DropdownMenuLabel>
            {items.map((item) => {
              const Icon = item.icon;
              const active = isNavigationActive(pathname, item.id);
              return (
                <DropdownMenuItem
                  key={item.id}
                  render={
                    <Link
                      aria-current={active ? "page" : undefined}
                      href={item.href}
                    />
                  }
                >
                  <Icon />
                  <span className="flex-1">{copy[item.id]}</span>
                  {active ? (
                    <span className="text-xs text-muted-foreground">
                      {copy.current}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function isNavigationActive(pathname: string, itemId: (typeof navigation)[number]["id"]) {
  if (itemId === "projects") return pathname.startsWith("/projects");
  if (itemId === "chat") return pathname.startsWith("/chat");
  return pathname.startsWith("/admin");
}

function getNavigationCopy(locale: ProductNavigationProps["locale"]) {
  if (locale === "zh-CN") {
    return {
      navigation: "全局导航",
      workspace: "工作区",
      switchWorkspace: "切换工作区",
      current: "当前",
      projects: "项目",
      chat: "AI 对话",
      admin: "管理后台",
    };
  }
  return {
    navigation: "Global navigation",
    workspace: "Workspace",
    switchWorkspace: "Switch workspace",
    current: "Current",
    projects: "Projects",
    chat: "AI Chat",
    admin: "Admin",
  };
}
