"use client";

import { Clapperboard, ListChecks, WalletCards } from "lucide-react";
import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type {
  StudioAgentContext,
  StudioLocale,
  StudioModelOption,
  StudioSelectionContext,
  WorkspaceSnapshot,
} from "../types";
import { AgentPanel } from "./agent-panel";
import { CostsPanel } from "./costs-panel";
import { OperationsPanel } from "./operations-panel";
import { TraceDialog } from "./trace-dialog";

const copy = {
  "zh-CN": { agent: "导演助手", costs: "费用", operations: "任务" },
  en: { agent: "Director", costs: "Costs", operations: "Tasks" },
} as const;

type InspectorTab = "agent" | "operations" | "costs";

export function StudioInspector({
  analysisModelId,
  context,
  locale,
  onRefresh,
  models,
  onAnalysisModelChange,
  snapshot,
  selections,
  onSelectContext,
  onEditContext,
  beforeSend,
}: {
  analysisModelId: string;
  context: StudioAgentContext;
  locale: StudioLocale;
  onRefresh: () => Promise<unknown> | void;
  models: StudioModelOption[];
  onAnalysisModelChange: (modelId: string) => void;
  snapshot: WorkspaceSnapshot;
  selections?: StudioSelectionContext[];
  onSelectContext?: (selection: StudioSelectionContext) => void;
  onEditContext?: (selection: StudioSelectionContext) => void;
  beforeSend?: () => Promise<boolean>;
}) {
  const text = copy[locale];
  const [activeTab, setActiveTab] = useState<InspectorTab>("agent");
  const [traceId, setTraceId] = useState("");
  return (
    <>
      <Tabs
        className="h-full min-h-0 min-w-0 gap-0 overflow-hidden bg-background"
        onValueChange={(value) => setActiveTab(value as InspectorTab)}
        value={activeTab}
      >
        <TabsList
          className="mx-3 my-0 grid h-11 w-auto shrink-0 grid-cols-3"
          variant="line"
        >
          <TabsTrigger value="agent">
            <Clapperboard className="size-3.5" />
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
        <TabsContent
          keepMounted
          className="min-h-0 overflow-hidden border-t data-hidden:hidden"
          value="agent"
        >
          <AgentPanel
            analysisModelId={analysisModelId}
            context={context}
            locale={locale}
            models={models}
            onAnalysisModelChange={onAnalysisModelChange}
            onRefresh={onRefresh}
            snapshot={snapshot}
            selections={selections}
            onSelectContext={onSelectContext}
            onEditContext={onEditContext}
            beforeSend={beforeSend}
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
