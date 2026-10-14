"use client";

import Link from "next/link";
import {
  Bell,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { workflowLabel } from "@/features/studio/workflow-labels";
import { cn } from "@/lib/utils";

type Notification = {
  id: string;
  kind: "completed" | "partial_failure" | "action_required";
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  href: string;
  readAt: string | null;
  createdAt: string;
};

type Preferences = {
  completedEnabled: boolean;
  partialFailureEnabled: boolean;
  actionRequiredEnabled: boolean;
};

const defaults: Preferences = {
  completedEnabled: true,
  partialFailureEnabled: true,
  actionRequiredEnabled: true,
};

export function ExecutionNotificationMenu({
  locale,
}: {
  locale: "en" | "zh-CN";
}) {
  const zh = locale === "zh-CN";
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [preferences, setPreferences] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [activeTab, setActiveTab] = useState("inbox");
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/user/notifications", {
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Notification inbox unavailable");
      const data = (await response.json()) as {
        items: Notification[];
        unreadCount: number;
        preferences: Preferences;
      };
      if (signal?.aborted) return;
      setItems(data.items);
      setUnreadCount(data.unreadCount);
      setPreferences(data.preferences);
      setLoadError(false);
    } catch {
      // Keep the last successfully loaded inbox visible when the network is unavailable.
      if (!signal?.aborted) setLoadError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setSaving(true);
      setSaveError(false);
      try {
        const response = await fetch("/api/user/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error("Notification update failed");
        await refresh();
        return true;
      } catch {
        setSaveError(true);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  const updatePreference = async (key: keyof Preferences, checked: boolean) => {
    const previous = preferences;
    const next = { ...preferences, [key]: checked };
    setPreferences(next);
    if (!(await patch({ action: "preferences", ...next }))) {
      setPreferences(previous);
    }
  };

  const markAllRead = () => {
    void patch({ action: "read_all" });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setActiveTab("inbox");
          void refresh();
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            aria-label={
              zh
                ? `执行通知${unreadCount ? `，${unreadCount} 条未读` : ""}`
                : `Execution notifications${unreadCount ? `, ${unreadCount} unread` : ""}`
            }
            className="relative"
            size="icon-sm"
            title={zh ? "执行通知" : "Execution notifications"}
            type="button"
            variant="ghost"
          />
        }
      >
        <Bell aria-hidden="true" />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-[9px] leading-4 text-destructive-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="max-h-[min(36rem,var(--available-height,calc(100dvh-2rem)))] w-[min(26rem,calc(100vw-1.5rem))] gap-0 overflow-hidden rounded-xl bg-[var(--canvas)] p-0 shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-3 pb-1 pt-3">
          <PopoverTitle className="text-sm font-semibold">
            {zh ? "执行通知" : "Execution notifications"}
          </PopoverTitle>
          <Button
            disabled={!unreadCount || saving || loading}
            onClick={markAllRead}
            size="sm"
            type="button"
            variant="ghost"
          >
            <CheckCheck aria-hidden="true" className="size-3.5" />
            {zh ? "全部已读" : "Mark all read"}
          </Button>
        </div>
        <Tabs className="min-h-0 flex-1 gap-0" value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mx-3 w-auto shrink-0 justify-start border-b border-border px-0" variant="line">
            <TabsTrigger className="flex-none gap-2 px-3 py-2" value="inbox">
              {zh ? "通知" : "Inbox"}
              {unreadCount > 0 ? (
                <Badge className="h-4 px-1.5 text-[10px]" variant="secondary">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger className="flex-none gap-2 px-3 py-2" value="preferences">
              <Settings2 aria-hidden="true" className="size-3.5" />
              {zh ? "通知设置" : "Preferences"}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            className="min-h-0 max-h-96 overflow-y-auto overscroll-contain p-2"
            value="inbox"
            aria-busy={loading}
          >
            {loading ? (
              <div className="flex min-h-40 items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
                {zh ? "正在加载通知" : "Loading notifications"}
              </div>
            ) : null}
            {!loading && loadError ? (
              <div className="flex flex-col items-center gap-2 px-3 py-4 text-xs text-muted-foreground" role="alert">
                <p>{zh ? "通知暂时无法更新，请稍后重试。" : "Notifications could not be updated. Try again."}</p>
                <Button onClick={() => void refresh()} size="sm" type="button" variant="outline">
                  {zh ? "重试" : "Retry"}
                </Button>
              </div>
            ) : null}
            {!loading && !loadError && items.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-muted-foreground">
                <span className="flex size-10 items-center justify-center rounded-full bg-muted">
                  <Bell aria-hidden="true" className="size-5" />
                </span>
                <p className="text-xs">{zh ? "暂无执行通知" : "No execution notifications"}</p>
              </div>
            ) : null}
            <ul className="space-y-0.5">
              {items.map((item) => (
                <ExecutionNotificationItem
                  key={item.id}
                  item={item}
                  locale={locale}
                  onRead={() => {
                    setOpen(false);
                    setSaveError(false);
                    if (!item.readAt)
                      void patch({ action: "read", id: item.id });
                  }}
                />
              ))}
            </ul>
          </TabsContent>
          <TabsContent className="min-h-0 max-h-96 overflow-y-auto overscroll-contain px-4 py-3" value="preferences">
            <p className="mb-3 text-xs leading-5 text-muted-foreground">{zh ? "选择需要接收的执行通知，修改后自动保存。" : "Choose the execution notifications you receive. Changes save automatically."}</p>
            <div className="divide-y divide-border">
              {([
                ["completedEnabled", zh ? "任务完成" : "Task completed", zh ? "工作流或媒体任务成功完成时通知" : "When a workflow or media task finishes successfully"],
                ["partialFailureEnabled", zh ? "部分失败" : "Partial failure", zh ? "已有步骤完成，但仍有部分步骤失败时通知" : "When some steps finish but others fail"],
                ["actionRequiredEnabled", zh ? "需要处理" : "Needs attention", zh ? "任务失败或等待人工确认时通知" : "When a task fails or needs your approval"],
              ] as const).map(([key, label, description]) => (
                <label key={key} className="flex min-h-16 cursor-pointer items-center justify-between gap-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{label}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
                  </span>
                  <Switch
                    aria-label={label}
                    checked={preferences[key]}
                    disabled={saving || loading || loadError}
                    onCheckedChange={(checked) => void updatePreference(key, checked)}
                  />
                </label>
              ))}
            </div>
          </TabsContent>
        </Tabs>
        <div className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          {saveError ? <p role="alert" className="text-destructive">{zh ? "修改未保存，请重试。" : "Changes could not be saved. Please retry."}</p> : saving ? <p role="status">{zh ? "正在保存…" : "Saving…"}</p> : <p>{activeTab === "preferences" ? (zh ? "设置仅影响后续通知" : "Preferences apply to future notifications") : (zh ? "显示最近 30 条通知，点击可查看执行详情" : "Showing up to 30 recent notifications. Open one for execution details.")}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const notificationAppearances = {
  completed: { icon: CircleCheck, className: "bg-status-success/10 text-status-success" },
  partial_failure: { icon: TriangleAlert, className: "bg-destructive/10 text-destructive" },
  action_required: { icon: CircleAlert, className: "bg-status-warning/10 text-status-warning" },
};

export function ExecutionNotificationItem({ item, locale, onRead }: {
  item: Notification;
  locale: "en" | "zh-CN";
  onRead: () => void;
}) {
  const zh = locale === "zh-CN";
  const { icon: Icon, className } = notificationAppearances[item.kind];
  return (
    <li>
      <Link
        className={cn("flex min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", !item.readAt && "bg-muted/50")}
        href={item.href}
        onClick={onRead}
      >
        <span className={cn("mt-1 flex size-6 shrink-0 items-center justify-center rounded-full", className)}>
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs font-medium leading-5">
              {zh ? item.titleZh : item.titleEn}
            </span>
            {!item.readAt ? (
              <span className="size-1.5 shrink-0 rounded-full bg-primary">
                <span className="sr-only">{zh ? "未读" : "Unread"}</span>
              </span>
            ) : null}
            <time className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground" dateTime={item.createdAt}>
              {formatRelativeTime(item.createdAt, locale)}
            </time>
          </span>
          <span className="block truncate text-[11px] leading-5 text-muted-foreground">
            {formatNotificationBody(item, locale)}
          </span>
        </span>
      </Link>
    </li>
  );
}

function formatNotificationBody(item: Notification, locale: "en" | "zh-CN") {
  const body = locale === "zh-CN" ? item.bodyZh : item.bodyEn;
  return body.replace(
    /^(工作流 |Workflow )([a-z][a-z0-9-]*) /,
    (_, prefix: string, type: string) => `${prefix}${workflowLabel(locale, type)} `,
  );
}

function formatRelativeTime(value: string, locale: "en" | "zh-CN") {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return locale === "zh-CN" ? "刚刚" : "now";
  if (minutes < 60)
    return locale === "zh-CN" ? `${minutes} 分钟前` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return locale === "zh-CN" ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return locale === "zh-CN" ? `${days} 天前` : `${days}d ago`;
}
