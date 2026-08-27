"use client";

import { Bot, ListChecks, WalletCards } from "lucide-react";
import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type {
  StudioAgentContext,
  StudioLocale,
  WorkspaceSnapshot,
} from "../types";
import { AgentPanel } from "./agent-panel";
import { CostsPanel } from "./costs-panel";
import { OperationsPanel } from "./operations-panel";
import { TraceDialog } from "./trace-dialog";

const copy = {
  "zh-CN": { agent: "Agent", costs: "费用", operations: "任务" },
  en: { agent: "Agent", costs: "Costs", operations: "Runs" },
} as const;

type InspectorTab = "agent" | "operations" | "costs";

export function StudioInspector({
  context,
  locale,
  onRefresh,
  snapshot,
}: {
  context: StudioAgentContext;
  locale: StudioLocale;
  onRefresh: () => Promise<unknown> | void;
  snapshot: WorkspaceSnapshot;
}) {
  const text = copy[locale];
  const [activeTab, setActiveTab] = useState<InspectorTab>("agent");
  const [traceId, setTraceId] = useState("");
  return (
    <>
      <Tabs
        className="h-full min-h-0 gap-0 bg-background"
        onValueChange={(value) => setActiveTab(value as InspectorTab)}
        value={activeTab}
      >
        <TabsList
          className="m-2 grid w-auto shrink-0 grid-cols-3"
          variant="default"
        >
          <TabsTrigger value="agent">
            <Bot className="size-3.5" />
            {text.agent}
          </TabsTrigger>
          <TabsTrigger value="operations">
            <ListChecks className="size-3.5" />
            {text.operations}
          </TabsTrigger>
          <TabsTrigger value="costs">
            <WalletCards className="size-3.5" />
            {text.costs}
          </TabsTrigger>
        </TabsList>
        <TabsContent className="min-h-0 border-t" value="agent">
          <AgentPanel
            context={context}
            locale={locale}
            onRefresh={onRefresh}
            snapshot={snapshot}
          />
        </TabsContent>
        <TabsContent className="min-h-0 border-t" value="operations">
          <OperationsPanel
            episodeId={context.episodeId}
            locale={locale}
            onRefresh={onRefresh}
            onTrace={setTraceId}
            snapshot={snapshot}
          />
        </TabsContent>
        <TabsContent className="min-h-0 border-t" value="costs">
          {activeTab === "costs" ? (
            <CostsPanel locale={locale} projectId={snapshot.project.id} />
          ) : null}
        </TabsContent>
      </Tabs>
      <TraceDialog
        locale={locale}
        onOpenChange={(open) => {
          if (!open) setTraceId("");
        }}
        traceId={traceId}
      />
    </>
  );
}
