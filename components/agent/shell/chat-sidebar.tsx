"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  Edit3,
  GripVertical,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { BrandAvatar } from "./brand-avatar";
import { primaryNavItems } from "./chat-shell-data";
import type { ShellCopy } from "./chat-shell-i18n";
import type {
  AgentLocale,
  ModelOption,
  ShellNavItem,
  ShellThread,
  ShellUser,
} from "./chat-shell-types";
import { ShellAccountMenu } from "./shell-account-menu";

type ChatSidebarProps = {
  activeThreadId: string | null;
  compact: boolean;
  copy: ShellCopy;
  locale: AgentLocale;
  models: ModelOption[];
  onLocaleChange: (locale: AgentLocale) => void;
  onArchiveThread?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onLogout?: () => void;
  onModelChange: (modelId: string) => void;
  onNewChat: () => void;
  onOpenArchive: () => void;
  onOpenExplore: () => void;
  onOpenHelp: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onRenameThread?: (threadId: string, title: string) => void;
  onReorderThread?: (draggedThreadId: string, targetThreadId: string) => void;
  onSelectThread: (threadId: string) => void;
  onToggleThreadPinned?: (threadId: string) => void;
  recentThreads: ShellThread[];
  selectedModel: string;
  user?: ShellUser | null;
};

export function ChatSidebar({
  activeThreadId,
  compact,
  copy,
  locale,
  models,
  onLocaleChange,
  onArchiveThread,
  onDeleteThread,
  onLogout,
  onModelChange,
  onNewChat,
  onOpenArchive,
  onOpenExplore,
  onOpenHelp,
  onOpenSearch,
  onOpenSettings,
  onRenameThread,
  onReorderThread,
  onSelectThread,
  onToggleThreadPinned,
  recentThreads,
  selectedModel,
  user,
}: ChatSidebarProps) {
  const [draggedThreadId, setDraggedThreadId] = useState<string | null>(null);
  const selectedModelName =
    models.find((model) => model.id === selectedModel)?.name ??
    copy.selectModel;
  const actionCopy = getThreadActionCopy(locale);
  const orderedThreads = useMemo(
    () => [...recentThreads].sort(comparePinnedThreads),
    [recentThreads],
  );

  return (
    <Sidebar className="overflow-hidden border-r border-sidebar-border/80" collapsible="icon">
      <SidebarHeader className="h-14 justify-center gap-0 border-b border-sidebar-border/70 px-3 py-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="grid h-9 grid-cols-[auto_1fr_auto] gap-2 px-2"
              onClick={onNewChat}
              size="lg"
              title={copy.newChat}
            >
              <BrandAvatar
                alt="Agent UI"
                className="size-7 rounded-md"
                size="default"
              />
              <span className="min-w-0 truncate font-medium">Agent UI</span>
              <Pencil className="size-4 text-sidebar-foreground/70" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup className="pt-1">
          <SidebarGroupContent>
            <SidebarMenu className="min-w-0">
              {primaryNavItems.map((item) => (
                <NavMenuItem
                  item={{ ...item, label: getPrimaryLabel(item.id, copy) }}
                  key={item.id}
                  onClick={
                    item.href
                      ? undefined
                      : item.id === "search"
                        ? onOpenSearch
                        : item.id === "explore"
                          ? onOpenExplore
                          : onOpenSettings
                  }
                  size={compact ? "sm" : "default"}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>{copy.recentChats}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="min-w-0">
              {orderedThreads.map((thread) => {
                const Icon = thread.icon ?? MessageSquare;

                return (
                  <ThreadMenuItem
                    actionCopy={actionCopy}
                    dragged={draggedThreadId === thread.id}
                    icon={Icon}
                    isActive={activeThreadId === thread.id}
                    key={thread.id}
                    onArchive={
                      onArchiveThread
                        ? () => onArchiveThread(thread.id)
                        : undefined
                    }
                    onDelete={
                      onDeleteThread
                        ? () => onDeleteThread(thread.id)
                        : undefined
                    }
                    onDragEnd={() => setDraggedThreadId(null)}
                    onDragOver={(event) => {
                      if (draggedThreadId && draggedThreadId !== thread.id) {
                        event.preventDefault();
                      }
                    }}
                    onDragStart={(event) => {
                      setDraggedThreadId(thread.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", thread.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceThreadId =
                        draggedThreadId ||
                        event.dataTransfer.getData("text/plain");

                      if (sourceThreadId && sourceThreadId !== thread.id) {
                        onReorderThread?.(sourceThreadId, thread.id);
                      }

                      setDraggedThreadId(null);
                    }}
                    onSelect={() => onSelectThread(thread.id)}
                    onRename={
                      onRenameThread
                        ? (title) => onRenameThread(thread.id, title)
                        : undefined
                    }
                    onTogglePinned={
                      onToggleThreadPinned
                        ? () => onToggleThreadPinned(thread.id)
                        : undefined
                    }
                    pinned={Boolean(thread.pinned)}
                    size={compact ? "sm" : "default"}
                    title={thread.title}
                  />
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/70 p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <ShellAccountMenu
              align="start"
              copy={copy}
              locale={locale}
              models={models}
              onLocaleChange={onLocaleChange}
              onLogout={onLogout}
              onModelChange={onModelChange}
              onNewChat={onNewChat}
              onOpenArchive={onOpenArchive}
              onOpenHelp={onOpenHelp}
              selectedModel={selectedModel}
              selectedModelName={selectedModelName}
              side="top"
              user={user}
              trigger={
                <SidebarMenuButton
                  className="grid h-10 grid-cols-[auto_1fr_auto] gap-2 px-2"
                  size="lg"
                  title={copy.openWorkspaceMenu}
                >
                  <BrandAvatar
                    alt={user?.name ?? copy.workspace}
                    fallback={(
                      user?.name.trim().slice(0, 2) || "AU"
                    ).toUpperCase()}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {user?.name ?? copy.workspace}
                  </span>
                  <MoreHorizontal className="size-4 text-sidebar-foreground/70" />
                </SidebarMenuButton>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function comparePinnedThreads(left: ShellThread, right: ShellThread) {
  if (left.pinned && !right.pinned) {
    return -1;
  }

  if (!left.pinned && right.pinned) {
    return 1;
  }

  return 0;
}

function getThreadActionCopy(locale: AgentLocale) {
  if (locale === "zh-CN") {
    return {
      delete: "删除会话",
      archive: "归档",
      cancel: "取消",
      menu: "会话操作",
      pin: "置顶",
      rename: "重命名",
      renamePrompt: "输入新的会话名称",
      restore: "取消归档",
      save: "确定",
      unpin: "取消置顶",
    };
  }

  return {
    delete: "Delete chat",
    archive: "Archive",
    cancel: "Cancel",
    menu: "Chat actions",
    pin: "Pin",
    rename: "Rename",
    renamePrompt: "Enter a new chat name",
    restore: "Unarchive",
    save: "Save",
    unpin: "Unpin",
  };
}

function getPrimaryLabel(itemId: string, copy: ShellCopy) {
  if (itemId === "drama-studio") {
    return copy.dramaStudio;
  }

  if (itemId === "search") {
    return copy.search;
  }

  if (itemId === "explore") {
    return copy.explore;
  }

  if (itemId === "settings") {
    return copy.settings;
  }

  return itemId;
}

function NavMenuItem({
  className,
  isActive,
  item,
  onClick,
  size = "default",
}: {
  className?: string;
  isActive?: boolean;
  item: ShellNavItem;
  onClick?: () => void;
  size?: "default" | "sm";
}) {
  const Icon = item.icon;

  return (
    <SidebarMenuItem className="min-w-0">
      <SidebarMenuButton
        className={cn("max-w-full", className)}
        isActive={isActive}
        onClick={onClick}
        render={item.href ? <Link href={item.href} /> : undefined}
        size={size}
        tooltip={item.label}
      >
        <Icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ThreadMenuItem({
  actionCopy,
  dragged,
  icon: Icon,
  isActive,
  onArchive,
  onDelete,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onRename,
  onSelect,
  onTogglePinned,
  pinned,
  size = "default",
  title,
}: {
  actionCopy: ReturnType<typeof getThreadActionCopy>;
  dragged: boolean;
  icon: ShellNavItem["icon"];
  isActive?: boolean;
  onArchive?: () => void;
  onDelete?: () => void;
  onDragEnd: () => void;
  onDragOver: (event: React.DragEvent<HTMLLIElement>) => void;
  onDragStart: (event: React.DragEvent<HTMLLIElement>) => void;
  onDrop: (event: React.DragEvent<HTMLLIElement>) => void;
  onRename?: (title: string) => void;
  onSelect: () => void;
  onTogglePinned?: () => void;
  pinned: boolean;
  size?: "default" | "sm";
  title: string;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(title);

  const handleRename = () => {
    if (!onRename) {
      return;
    }

    setRenameValue(title);
    setRenameOpen(true);
  };

  const submitRename = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextTitle = renameValue.trim();

    if (!nextTitle || !onRename) return;

    onRename(nextTitle);
    setRenameOpen(false);
  };
  const actions = {
    archive: onArchive,
    delete: onDelete,
    rename: onRename ? handleRename : undefined,
    togglePinned: onTogglePinned,
  };

  return (
    <>
      <ContextMenu>
      <ContextMenuTrigger
        render={
          <SidebarMenuItem
          className={cn(
            "min-w-0 rounded-md",
            dragged && "opacity-55 outline outline-1 outline-sidebar-ring",
          )}
          draggable
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDragStart={onDragStart}
          onDrop={onDrop}
          />
        }
      >
          <SidebarMenuButton
            className="max-w-full cursor-grab font-normal active:cursor-grabbing"
            isActive={isActive}
            onClick={onSelect}
            size={size}
            tooltip={title}
          >
            <GripVertical className="size-3.5 text-sidebar-foreground/45" />
            {pinned ? (
              <Pin className="size-3.5 fill-current text-sidebar-foreground/70" />
            ) : (
              <Icon />
            )}
            <span>{title}</span>
          </SidebarMenuButton>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <SidebarMenuAction
                  aria-label={actionCopy.menu}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onDragStart={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  showOnHover
                >
                  <MoreHorizontal />
                </SidebarMenuAction>
              }
            />
            <DropdownMenuContent align="end" className="w-36" side="right">
              <ThreadDropdownActions
                actionCopy={actionCopy}
                actions={actions}
                pinned={pinned}
              />
            </DropdownMenuContent>
          </DropdownMenu>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        <ThreadContextActions
          actionCopy={actionCopy}
          actions={actions}
          pinned={pinned}
        />
      </ContextMenuContent>
      </ContextMenu>
      <Dialog onOpenChange={setRenameOpen} open={renameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{actionCopy.rename}</DialogTitle>
            <DialogDescription>{actionCopy.renamePrompt}</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submitRename}>
            <div className="grid gap-2">
              <Label className="sr-only" htmlFor={`rename-thread-${title}`}>
                {actionCopy.renamePrompt}
              </Label>
              <Input
                autoFocus
                id={`rename-thread-${title}`}
                onChange={(event) => setRenameValue(event.target.value)}
                value={renameValue}
              />
            </div>
            <DialogFooter>
              <Button onClick={() => setRenameOpen(false)} type="button" variant="outline">
                {actionCopy.cancel}
              </Button>
              <Button type="submit">{actionCopy.save}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

type ThreadActions = {
  archive?: () => void;
  delete?: () => void;
  rename?: () => void;
  togglePinned?: () => void;
};

function ThreadDropdownActions({
  actionCopy,
  actions,
  pinned,
}: {
  actionCopy: ReturnType<typeof getThreadActionCopy>;
  actions: ThreadActions;
  pinned: boolean;
}) {
  return (
    <>
      <DropdownMenuItem
        onClick={(event) => {
          event.stopPropagation();
          actions.rename?.();
        }}
      >
        <Edit3 />
        {actionCopy.rename}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={(event) => {
          event.stopPropagation();
          actions.togglePinned?.();
        }}
      >
        {pinned ? <PinOff /> : <Pin />}
        {pinned ? actionCopy.unpin : actionCopy.pin}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={(event) => {
          event.stopPropagation();
          actions.archive?.();
        }}
      >
        <Archive />
        {actionCopy.archive}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={(event) => {
          event.stopPropagation();
          actions.delete?.();
        }}
        variant="destructive"
      >
        <Trash2 />
        {actionCopy.delete}
      </DropdownMenuItem>
    </>
  );
}

function ThreadContextActions({
  actionCopy,
  actions,
  pinned,
}: {
  actionCopy: ReturnType<typeof getThreadActionCopy>;
  actions: ThreadActions;
  pinned: boolean;
}) {
  return (
    <>
      <ContextMenuItem onClick={actions.rename}>
        <Edit3 />
        {actionCopy.rename}
      </ContextMenuItem>
      <ContextMenuItem onClick={actions.togglePinned}>
        {pinned ? <PinOff /> : <Pin />}
        {pinned ? actionCopy.unpin : actionCopy.pin}
      </ContextMenuItem>
      <ContextMenuItem onClick={actions.archive}>
        <Archive />
        {actionCopy.archive}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={actions.delete} variant="destructive">
        <Trash2 />
        {actionCopy.delete}
      </ContextMenuItem>
    </>
  );
}
