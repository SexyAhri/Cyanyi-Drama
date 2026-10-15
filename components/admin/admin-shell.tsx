"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  CreditCard,
  Landmark,
  Menu,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";

import { AuthAccountMenu } from "@/components/auth/account-menu";
import {
  ProductBrand,
  ProductNavigation,
} from "@/components/navigation/product-navigation";
import { ThemeToggle } from "@/components/theme-toggle";
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
import type { AuthUser } from "@/lib/server/auth";

const navigationGroups = [
  {
    label: "模型服务",
    items: [
      { href: "/admin/channels", label: "模型渠道", icon: SlidersHorizontal },
      { href: "/admin/usage", label: "用量记录", icon: Activity },
    ],
  },
  {
    label: "资金管理",
    items: [
      { href: "/admin/billing", label: "计费与余额", icon: CreditCard },
      { href: "/admin/topups", label: "充值订单", icon: Landmark },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/admin/system", label: "系统设置", icon: Settings2 },
    ],
  },
] as const;

export function AdminShell({
  children,
  user,
}: React.PropsWithChildren<{ user: AuthUser }>) {
  const pathname = usePathname();

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-background">
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar/70 lg:flex lg:flex-col">
        <Link
          className="flex h-14 items-center gap-2 border-b px-4 text-sm font-medium text-muted-foreground hover:text-foreground"
          href="/projects"
        >
          <ArrowLeft className="size-4" />
          <span>返回创作空间</span>
        </Link>
        <nav aria-label="后台导航" className="flex-1 overflow-y-auto p-3">
          {navigationGroups.map((group, groupIndex) => (
            <div
              className={cn("grid gap-1", groupIndex > 0 && "mt-5")}
              key={group.label}
            >
              <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((item) => {
                const active = pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      buttonVariants({
                        variant: active ? "secondary" : "ghost",
                      }),
                      "h-9 justify-start gap-2 px-3",
                    )}
                    href={item.href}
                    key={item.href}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-5">
          <AdminMobileNavigation pathname={pathname} />
          <ProductBrand />
          <ProductNavigation isAdmin locale="zh-CN" />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ThemeToggle label="切换主题" />
            <AuthAccountMenu compact locale="zh-CN" user={user} />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function AdminMobileNavigation({ pathname }: { pathname: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="打开后台菜单"
            className="lg:hidden"
            size="icon-sm"
            title="后台菜单"
            type="button"
            variant="ghost"
          />
        }
      >
        <Menu />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {navigationGroups.map((group) => (
          <DropdownMenuGroup key={group.label}>
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.items.map((item) => {
              const active = pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <DropdownMenuItem
                  key={item.href}
                  render={
                    <Link
                      aria-current={active ? "page" : undefined}
                      href={item.href}
                    />
                  }
                >
                  <Icon />
                  <span className="flex-1">{item.label}</span>
                  {active ? (
                    <span className="text-xs text-muted-foreground">当前</span>
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
