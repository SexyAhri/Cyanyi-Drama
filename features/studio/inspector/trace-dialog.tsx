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
import { buildTraceRows } from "./inspector-view-model";

const copy = {
  "zh-CN": {
    attributes: "属性",
    events: "事件",
    loadFailed: "Trace 载入失败",
    loading: "正在载入 Trace",
    noEvents: "没有事件记录",
    noSpans: "没有 Span 记录",
    spans: "调用链",
    title: "执行 Trace",
  },
  en: {
    attributes: "Attributes",
    events: "Events",
    loadFailed: "Unable to load trace",
    loading: "Loading trace",
    noEvents: "No events",
    noSpans: "No spans",
    spans: "Spans",
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
    setTrace(null);
    setError("");
    setSelectedSpanId("");
    void loadStudioTrace(traceId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setTrace(result);
          setSelectedSpanId(result.rootSpanId ?? result.spans[0]?.spanId ?? "");
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted)
          setError(
            requestError instanceof Error
              ? requestError.message
              : text.loadFailed,
          );
      });
    return () => controller.abort();
  }, [text.loadFailed, traceId]);

  const rows = useMemo(
    () => buildTraceRows(trace?.spans ?? []),
    [trace?.spans],
  );
  const selectedSpan = trace?.spans.find(
    (span) => span.spanId === selectedSpanId,
  );

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
                            {span.name}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                            {span.kind}
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
                    span={selectedSpan}
                    text={text.attributes}
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
                  {trace.events.map((event) => (
                    <div className="px-5 py-3" key={event.id}>
                      <div className="flex items-start gap-3">
                        <Clock3 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2">
                            <p className="min-w-0 flex-1 truncate text-xs font-medium">
                              {event.type}
                            </p>
                            {event.status ? (
                              <StatusIndicator
                                compact
                                locale={locale}
                                status={runtimeStatusToStageStatus(
                                  event.status,
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
                            {event.source} ·{" "}
                            {formatStudioDate(locale, event.createdAt)} ·{" "}
                            {event.spanId}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
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
  span,
  text,
}: {
  locale: StudioLocale;
  span?: StudioExecutionSpan;
  text: string;
}) {
  if (!span) return <div />;
  return (
    <div className="min-h-0 overflow-y-auto p-5">
      <div className="flex items-start gap-3 border-b pb-4">
        <SpanIcon span={span} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{span.name}</h3>
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
        <Detail label="Kind" value={span.kind} />
        <Detail
          label="Started"
          value={formatStudioDate(locale, span.startedAt)}
        />
        <Detail label="Parent" value={span.parentSpanId ?? "-"} />
        <Detail
          label="Completed"
          value={
            span.completedAt ? formatStudioDate(locale, span.completedAt) : "-"
          }
        />
      </dl>
      <h4 className="mt-4 text-xs font-semibold">{text}</h4>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap wrap-break-word rounded-md bg-muted/50 p-3 font-mono text-[11px] leading-5">
        {JSON.stringify(span.attributes, null, 2)}
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
