"use client";

import {
  Archive,
  CircleHelp,
  LogOut,
  Languages,
  MessageSquarePlus,
  Sparkles,
  UserRound,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { BrandAvatar } from "./brand-avatar";
import type { ShellCopy } from "./chat-shell-i18n";
import type { AgentLocale, ModelOption, ShellUser } from "./chat-shell-types";

type ShellAccountMenuProps = {
  align?: "center" | "end" | "start";
  copy: ShellCopy;
  locale: AgentLocale;
  models: ModelOption[];
  onNewChat: () => void;
  onLogout?: () => void;
  onOpenArchive: () => void;
  onOpenHelp: () => void;
  onLocaleChange: (locale: AgentLocale) => void;
  onModelChange: (modelId: string) => void;
  selectedModelName?: string;
  selectedModel: string;
  side?: "bottom" | "left" | "right" | "top";
  trigger: React.ReactElement;
  user?: ShellUser | null;
};

export function ShellAccountMenu({
  align = "end",
  copy,
  locale,
  models,
  onNewChat,
  onOpenArchive,
  onOpenHelp,
  onLocaleChange,
  onLogout,
  onModelChange,
  selectedModelName,
  selectedModel,
  side = "bottom",
  trigger,
  user,
}: ShellAccountMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align={align} className="w-64" side={side}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2">
            <BrandAvatar
              alt={user?.name ?? copy.accountLabel}
              fallback={getUserInitials(user?.name)}
            />
            <span className="min-w-0 truncate">
              {user?.name ?? copy.accountLabel}
            </span>
          </DropdownMenuLabel>
          {selectedModelName ? (
            <DropdownMenuLabel className="flex items-center gap-2 font-normal">
              <UserRound className="size-4" />
              <span
                className="min-w-0 truncate"
                title={`${copy.currentModel}: ${selectedModelName}`}
              >
                {copy.currentModel}: {selectedModelName}
              </span>
            </DropdownMenuLabel>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Sparkles />
            <span>{copy.switchModel}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            <DropdownMenuRadioGroup
              onValueChange={onModelChange}
              value={selectedModel}
            >
              {models.map((model) => (
                <DropdownMenuRadioItem key={model.id} value={model.id}>
                  <span className="min-w-0 truncate" title={model.name}>
                    {model.name}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages />
            <span>{copy.switchLanguage}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            <DropdownMenuRadioGroup
              onValueChange={(value) => {
                if (value === "en" || value === "zh-CN") {
                  onLocaleChange(value);
                }
              }}
              value={locale}
            >
              <DropdownMenuRadioItem value="en">
                {copy.english}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="zh-CN">
                {copy.chinese}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onNewChat}>
          <MessageSquarePlus />
          <span>{copy.newChat}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenHelp}>
          <CircleHelp />
          <span>{copy.help}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenArchive}>
          <Archive />
          <span>{copy.archivedChats}</span>
        </DropdownMenuItem>
        {onLogout ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout}>
              <LogOut />
              <span>{copy.logout}</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getUserInitials(name: string | undefined) {
  return (name?.trim().slice(0, 2) || "AU").toUpperCase();
}
