"use client";

import {
  Braces,
  Clock3,
  LoaderCircle,
  Route,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { loadStudioTrace } from "../api";
import { formatStudioDate } from "../i18n";
import { runtimeStatusToStageStatus } from "../stage-state";
import type {
  StudioExecutionSpan,
  StudioExecutionTrace,
  StudioLocale,
} from "../types";
import { StatusIndicator } from "../components/status-indicator";
import {
  buildTraceRows,
  localizedTraceAttributes,
  traceEventDisplayStatus,
  traceEventLabel,
  traceEventSourceLabel,
  traceSpanKindLabel,
  traceSpanLabel,
} from "./inspector-view-model";

const copy = {
  "zh-CN": {
    attributes: "属性",
    completed: "完成时间",
    events: "事件",
    kind: "类型",
    loadFailed: "Trace 载入失败",
    loading: "正在载入 Trace",
    noEvents: "没有事件记录",
    noSpans: "没有 Span 记录",
    parent: "上级节点",
    spans: "调用链",
    started: "开始时间",
    title: "执行 Trace",
  },
  en: {
    attributes: "Attributes",
    completed: "Completed",
    events: "Events",
    kind: "Kind",
    loadFailed: "Unable to load trace",
    loading: "Loading trace",
    noEvents: "No events",
    noSpans: "No spans",
    parent: "Parent",
    spans: "Spans",
    started: "Started",
    title: "Execution trace",
  },
} as const;

export function TraceDialog({
  locale,
  onOpenChange,
  traceId,
}: {
  locale: StudioLocale;
  onOpenChange: (open: boolean) => void;
  traceId: string;
}) {
  const text = copy[locale];
  const [trace, setTrace] = useState<StudioExecutionTrace | null>(null);
  const [error, setError] = useState("");
  const [selectedSpanId, setSelectedSpanId] = useState("");

  useEffect(() => {
    if (!traceId) return;
    const controller = new AbortController();
    let loading = false;
    setTrace(null);
    setError("");
    setSelectedSpanId("");
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await loadStudioTrace(traceId, controller.signal);
        if (controller.signal.aborted) return;
        setTrace(result);
        setError("");
        setSelectedSpanId((current) =>
          current && result.spans.some((span) => span.spanId === current)
            ? current
            : (result.rootSpanId ?? result.spans[0]?.spanId ?? ""),
        );
      } catch (requestError) {
        if (!controller.signal.aborted)
          setError(
            requestError instanceof Error
              ? requestError.message
              : text.loadFailed,
          );
      } finally {
        loading = false;
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => {
      window.clearInterval(interval);
      controller.abort();
    };
  }, [text.loadFailed, traceId]);

  const rows = useMemo(
    () => buildTraceRows(trace?.spans ?? []),
    [trace?.spans],
  );
  const selectedSpan = trace?.spans.find(
    (span) => span.spanId === selectedSpanId,
  );
  const spansById = useMemo(
    () => new Map((trace?.spans ?? []).map((span) => [span.spanId, span])),
    [trace?.spans],
  );
  const latestEventIdsBySpan = useMemo(() => {
    const latest = new Map<string, string>();
    for (const event of trace?.events ?? []) latest.set(event.spanId, event.id);
    return latest;
  }, [trace?.events]);

  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(traceId)}>
      <DialogContent className="grid h-[min(88dvh,48rem)] max-w-5xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <Route className="size-4" />
            {text.title}
          </DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">
            {traceId}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div
            className="flex min-h-0 items-center justify-center gap-2 px-6 text-sm text-destructive"
            role="alert"
          >
            <TriangleAlert aria-hidden="true" className="size-4" />
            {error}
          </div>
        ) : !trace ? (
          <div
            className="flex min-h-0 items-center justify-center text-muted-foreground"
            role="status"
          >
            <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
            <span className="sr-only">{text.loading}</span>
          </div>
        ) : (
          <Tabs className="min-h-0 gap-0" defaultValue="spans">
            <TabsList className="mx-5 my-3" variant="line">
              <TabsTrigger value="spans">
                <Route className="size-3.5" />
                {text.spans} · {trace.spans.length}
              </TabsTrigger>
              <TabsTrigger value="events">
                <Clock3 className="size-3.5" />
                {text.events} · {trace.events.length}
              </TabsTrigger>
            </TabsList>
            <TabsContent className="min-h-0 border-t" value="spans">
              {rows.length ? (
                <div className="grid h-full min-h-0 md:grid-cols-[21rem_minmax(0,1fr)]">
                  <div className="min-h-0 overflow-y-auto border-b md:border-r md:border-b-0">
                    {rows.map(({ depth, span }) => (
                      <button
                        className={cn(
                          "flex w-full items-center gap-2 border-b px-3 py-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                          selectedSpanId === span.spanId && "bg-muted",
                        )}
                        key={span.spanId}
                        onClick={() => setSelectedSpanId(span.spanId)}
                        style={{
                          paddingLeft: `${12 + Math.min(depth, 4) * 14}px`,
                        }}
                        type="button"
                      >
                        <SpanIcon span={span} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">
                            {traceSpanLabel(span, locale)}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                            {traceSpanKindLabel(span.kind, locale)}
                          </span>
                        </span>
                        <StatusIndicator
                          compact
                          locale={locale}
                          status={runtimeStatusToStageStatus(span.status)}
                        />
                      </button>
                    ))}
                  </div>
                  <SpanDetails
                    locale={locale}
                    parent={trace?.spans.find(
                      (span) => span.spanId === selectedSpan?.parentSpanId,
                    )}
                    span={selectedSpan}
                    text={text}
                  />
                </div>
              ) : (
                <Empty label={text.noSpans} />
              )}
            </TabsContent>
            <TabsContent
              className="min-h-0 overflow-y-auto border-t"
              value="events"
            >
              {trace.events.length ? (
                <div className="divide-y">
                  {trace.events.map((event) => {
                    const displayStatus = traceEventDisplayStatus(
                      event,
                      spansById.get(event.spanId)?.status,
                      latestEventIdsBySpan.get(event.spanId) === event.id,
                    );
                    return (
                      <div className="px-5 py-3" key={event.id}>
                        <div className="flex items-start gap-3">
                          <Clock3 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-2">
                              <p className="min-w-0 flex-1 truncate text-xs font-medium">
                                {traceEventLabel(event.type, locale)}
                              </p>
                              {displayStatus ? (
                                <StatusIndicator
                                  compact
                                  locale={locale}
                                  status={runtimeStatusToStageStatus(
                                    displayStatus,
                                  )}
                                />
                              ) : null}
                            </div>
                            {event.message ? (
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                {event.message}
                              </p>
                            ) : null}
                            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/75">
                              {traceEventSourceLabel(event.source, locale)} ·{" "}
                              {formatStudioDate(locale, event.createdAt)} ·{" "}
                              {event.spanId}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Empty label={text.noEvents} />
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SpanDetails({
  locale,
  parent,
  span,
  text,
}: {
  locale: StudioLocale;
  parent?: StudioExecutionSpan;
  span?: StudioExecutionSpan;
  text: (typeof copy)[StudioLocale];
}) {
  if (!span) return <div />;
  return (
    <div className="min-h-0 overflow-y-auto p-5">
      <div className="flex items-start gap-3 border-b pb-4">
        <SpanIcon span={span} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">
            {traceSpanLabel(span, locale)}
          </h3>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {span.spanId}
          </p>
        </div>
        <StatusIndicator
          locale={locale}
          status={runtimeStatusToStageStatus(span.status)}
        />
      </div>
      <dl className="grid gap-x-6 gap-y-3 border-b py-4 text-xs sm:grid-cols-2">
        <Detail label={text.kind} value={traceSpanKindLabel(span.kind, locale)} />
        <Detail
          label={text.started}
          value={formatStudioDate(locale, span.startedAt)}
        />
        <Detail
          label={text.parent}
          value={parent ? traceSpanLabel(parent, locale) : "-"}
        />
        <Detail
          label={text.completed}
          value={
            span.completedAt ? formatStudioDate(locale, span.completedAt) : "-"
          }
        />
      </dl>
      <h4 className="mt-4 text-xs font-semibold">{text.attributes}</h4>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap wrap-break-word rounded-md bg-muted/50 p-3 font-mono text-[11px] leading-5">
        {JSON.stringify(localizedTraceAttributes(span.attributes, locale), null, 2)}
      </pre>
    </div>
  );
}

function SpanIcon({ span }: { span: StudioExecutionSpan }) {
  return span.kind === "prompt" ? (
    <Braces className="mt-0.5 size-3.5 shrink-0" />
  ) : (
    <Route className="mt-0.5 size-3.5 shrink-0" />
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-mono">{value}</dd>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-56 items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
