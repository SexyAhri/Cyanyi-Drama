"use client";
import { useRef, useState, type ReactNode } from "react";
import { Bot, Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { agentDisplayName } from "./agent-presentation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ModelOption } from "@/components/agent/shell/chat-shell-types";
import { PROMPT_IDS } from "@/lib/prompts/ids";
import type { AgentConfiguration } from "@/lib/production-configuration/contract";
import {
  DEFAULT_STUDIO_AGENT_CONTEXT_SCOPES,
  type StudioAgentContextScope,
} from "@/lib/studio/agent-context-policy";
import type { getConfigurationAgentCatalog } from "@/lib/production-configuration/agents";
import { ConfigurationField } from "./fields";
import type { ProductionCopy } from "./copy";
import { ConfigurationHelp } from "./field-help";
import {
  insertTemplateVariable,
  inspectTemplateVariables,
  previewTemplateVariables,
} from "@/lib/production-configuration/template-variables";
import { AgentTestRunner } from "./agent-test-runner";
import type { ConfigurationScope } from "@/lib/production-configuration/contract";
export type ConfigurationAgent = ReturnType<
  typeof getConfigurationAgentCatalog
>[number];

export function AgentEditor({
  catalog,
  agents,
  patch,
  onChange,
  models,
  source,
  copy,
  testScope,
}: {
  catalog: ConfigurationAgent[];
  agents: Record<string, AgentConfiguration>;
  patch: Record<string, AgentConfiguration>;
  onChange: (patch: Record<string, AgentConfiguration>) => void;
  models: ModelOption[];
  source: (field: string) => string;
  copy: ProductionCopy;
  testScope?: ConfigurationScope;
}) {
  const [selected, setSelected] = useState<string>(
    PROMPT_IDS.STUDIO_WORKFLOW_AGENT,
  );
  const [query, setQuery] = useState("");
  const templateRefs = useRef<
    Partial<Record<"templateZh" | "templateEn", HTMLTextAreaElement | null>>
  >({});
  const entry = catalog.find((item) => item.id === selected) ?? catalog[0];
  if (!entry) return null;
  const agent = agents[entry.id] ?? {};
  const local = patch[entry.id] ?? {};
  const change = (value: Partial<AgentConfiguration>) =>
    onChange({ ...patch, [entry.id]: { ...local, ...value } });
  const reset = (keys: Array<keyof AgentConfiguration>) => {
    const next = { ...local };
    keys.forEach((key) => delete next[key]);
    onChange({ ...patch, [entry.id]: next });
  };
  const field = (key: keyof AgentConfiguration, children: React.ReactNode) => (
    <ConfigurationField
      key={key}
      label={
        key === "maxCorrections"
          ? copy.corrections
          : key === "disabledOperations"
            ? copy.tools
            : copy[key as keyof ProductionCopy]
      }
      copy={copy}
      source={
        key === "fallbackModel"
          ? source(`agents.${entry.id}.fallbackModel`)
          : source(`agents.${entry.id}.${key}`)
      }
      overridden={
        key === "fallbackModel"
          ? "fallbackModel" in local || "fallbackChannelId" in local
          : key in local
      }
      onInherit={() =>
        reset(
          key === "fallbackModel"
            ? ["fallbackModel", "fallbackChannelId"]
            : [key],
        )
      }
    >
      {children}
    </ConfigurationField>
  );
  const textModels = models.filter(
    (model) =>
      (model.type === "llm" ||
        model.capabilities?.modalities.includes("text")) &&
      model.channelId &&
      model.modelId &&
      ["openai-compatible", "volcengine-ark"].includes(model.protocol ?? ""),
  );
  const contextOptions: Array<[StudioAgentContextScope, string]> = [
    ["project_materials", copy.contextProjectMaterials],
    ["current_episode", copy.contextCurrentEpisode],
    ["character_assets", copy.contextCharacterAssets],
    ["selected_shot", copy.contextSelectedShot],
  ];
  const english = copy.testRunLocale === "en";
  const displayName = (item: ConfigurationAgent) =>
    agents[item.id]?.name || agentDisplayName(item.id, item.name, english);
  const ordered = [...catalog].sort(
    (a, b) =>
      Number(b.id === PROMPT_IDS.STUDIO_WORKFLOW_AGENT) -
      Number(a.id === PROMPT_IDS.STUDIO_WORKFLOW_AGENT),
  );
  const matches = ordered.filter((item) =>
    `${displayName(item)} ${item.id} ${agents[item.id]?.responsibility ?? item.responsibility}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const customized = Object.keys(local).length > 0;
  const card = (title: string, children: ReactNode) => (
    <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <h4 className="text-sm font-semibold">{title}</h4>
      {children}
    </section>
  );
  return (
    <div className="grid min-h-0 min-w-0 flex-1 gap-3 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside
        className="hidden min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card lg:flex"
        aria-label={copy.agent}
      >
        <div className="shrink-0 border-b p-3">
          <div className="mb-3 flex items-center justify-between text-sm font-semibold">
            <span>{copy.agents}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {catalog.length}
            </span>
          </div>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
            />
            <Input
              className="pl-9"
              aria-label={copy.agentSearch}
              placeholder={copy.agentSearch}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <nav
          className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2"
          aria-label={copy.agent}
        >
          {matches.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant="ghost"
              aria-current={entry.id === item.id ? "true" : undefined}
              className={`h-auto min-h-11 w-full items-center justify-start gap-2 rounded-lg px-3 py-2.5 text-left whitespace-normal ${entry.id === item.id ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary" : ""}`}
              onClick={() => setSelected(item.id)}
            >
              <Bot aria-hidden="true" className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="break-anywhere text-sm font-medium">
                    {displayName(item)}
                  </span>
                  {Object.keys(patch[item.id] ?? {}).length > 0 && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-primary"
                      aria-label={copy.agentConfigured}
                    />
                  )}
                </span>
              </span>
            </Button>
          ))}
          {matches.length === 0 && (
            <p
              role="status"
              className="px-3 py-6 text-center text-xs text-muted-foreground"
            >
              {copy.agentNoResults}
            </p>
          )}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
        <label className="block shrink-0 space-y-1 text-xs font-medium lg:hidden">
          {copy.agent}
          <NativeSelect
            className="min-h-11"
            aria-label={copy.agent}
            value={entry.id}
            onChange={(event) => setSelected(event.target.value)}
          >
            {ordered.map((item) => (
              <option key={item.id} value={item.id}>
                {displayName(item)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className="flex shrink-0 items-center gap-3 rounded-xl border bg-card p-3 sm:p-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Bot aria-hidden="true" className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-anywhere text-base font-semibold">
                {displayName(entry)}
              </h3>
              <span
                className={`rounded-md px-2 py-1 text-xs ${customized ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
              >
                {customized ? copy.agentConfigured : copy.agentBuiltIn}
              </span>
            </div>
            <p className="mt-1 break-anywhere text-xs text-muted-foreground">
              {copy.model}: {agent.model ?? copy.inherited}
            </p>
          </div>
          <ConfigurationHelp label={copy.agentHelpLabel}>
            {copy.agentHelp}
          </ConfigurationHelp>
        </div>
        <Tabs defaultValue="identity" className="min-h-0 min-w-0 flex-1">
          <TabsList
            variant="line"
            className="w-full min-w-0 shrink-0 flex-row justify-start gap-2 border-b sm:gap-5"
          >
            <TabsTrigger
              value="identity"
              className="min-h-11 min-w-0 flex-1 whitespace-normal px-1 text-xs sm:flex-none sm:text-sm"
            >
              {copy.agentIdentityTab}
            </TabsTrigger>
            <TabsTrigger
              value="prompts"
              className="min-h-11 min-w-0 flex-1 whitespace-normal px-1 text-xs sm:flex-none sm:text-sm"
            >
              {copy.agentPromptTab}
            </TabsTrigger>
            <TabsTrigger
              value="runtime"
              className="min-h-11 min-w-0 flex-1 whitespace-normal px-1 text-xs sm:flex-none sm:text-sm"
            >
              {copy.agentRuntimeTab}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="identity"
            className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pt-2 pr-1 pb-2"
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              {copy.agentOverviewHelp}
            </p>
            {card(
              copy.agentBehaviorSection,
              <div className="space-y-4">
                {field(
                  "name",
                  <Input
                    aria-label={copy.name}
                    value={
                      agent.name ??
                      agentDisplayName(
                        entry.id,
                        entry.name,
                        copy.testRunLocale === "en",
                      )
                    }
                    maxLength={120}
                    onChange={(e) => change({ name: e.target.value })}
                  />,
                )}
                {field(
                  "responsibility",
                  <Textarea
                    aria-label={copy.responsibility}
                    value={agent.responsibility ?? entry.responsibility}
                    maxLength={4000}
                    onChange={(e) => change({ responsibility: e.target.value })}
                  />,
                )}
                {field(
                  "taskScope",
                  <Textarea
                    aria-label={copy.taskScope}
                    value={agent.taskScope ?? entry.taskScope}
                    maxLength={4000}
                    onChange={(e) => change({ taskScope: e.target.value })}
                  />,
                )}
                {field(
                  "systemInstructions",
                  <Textarea
                    aria-label={copy.systemInstructions}
                    value={agent.systemInstructions ?? ""}
                    maxLength={16000}
                    onChange={(e) =>
                      change({ systemInstructions: e.target.value })
                    }
                  />,
                )}
              </div>,
            )}
            {card(
              copy.agentQualitySection,
              <div className="space-y-4">
                {field(
                  "acceptanceCriteria",
                  <Textarea
                    aria-label={copy.acceptanceCriteria}
                    value={agent.acceptanceCriteria ?? entry.acceptanceCriteria}
                    maxLength={4000}
                    onChange={(e) =>
                      change({ acceptanceCriteria: e.target.value })
                    }
                  />,
                )}
                {field(
                  "stopConditions",
                  <Textarea
                    aria-label={copy.stopConditions}
                    value={agent.stopConditions ?? entry.stopConditions}
                    maxLength={4000}
                    onChange={(e) => change({ stopConditions: e.target.value })}
                  />,
                )}
                {field(
                  "styleRequirements",
                  <Textarea
                    aria-label={copy.styleRequirements}
                    value={agent.styleRequirements ?? entry.styleRequirements}
                    maxLength={4000}
                    onChange={(e) =>
                      change({ styleRequirements: e.target.value })
                    }
                  />,
                )}
                {field(
                  "examples",
                  <Textarea
                    aria-label={copy.examples}
                    value={agent.examples ?? entry.examples}
                    maxLength={12000}
                    onChange={(e) => change({ examples: e.target.value })}
                  />,
                )}
                {field(
                  "qualityChecks",
                  <Textarea
                    aria-label={copy.qualityChecks}
                    value={
                      agent.qualityChecks?.join("\n") ??
                      entry.qualityChecks?.join("\n") ??
                      ""
                    }
                    placeholder={copy.qualityChecks}
                    onChange={(e) =>
                      change({
                        qualityChecks: e.target.value
                          .split(/\r?\n/)
                          .map((item) => item.trim())
                          .filter(Boolean)
                          .slice(0, 20),
                      })
                    }
                  />,
                )}
              </div>,
            )}
          </TabsContent>
          <TabsContent
            value="prompts"
            className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pt-2 pr-1 pb-2"
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              {copy.agentPromptHelp}
            </p>
            <div className="min-w-0 space-y-5 rounded-xl border bg-card p-4 sm:p-5">
              <p className="break-anywhere text-xs text-muted-foreground">
                {copy.variables}:{" "}
                {entry.variables.map((key) => `{{${key}}}`).join(" · ")}
              </p>
              {(["templateZh", "templateEn"] as const).map((key) =>
                field(
                  key,
                  <div className="space-y-2">
                    {(() => {
                      const template = agent[key] ?? entry[key];
                      const { missing, unknown } = inspectTemplateVariables(
                        template,
                        entry.variables,
                      );
                      const insertVariable = (name: string) => {
                        const textarea = templateRefs.current[key];
                        const start =
                          textarea?.selectionStart ?? template.length;
                        const end = textarea?.selectionEnd ?? start;
                        const inserted = insertTemplateVariable(
                          template,
                          name,
                          start,
                          end,
                        );
                        change({ [key]: inserted.template });
                        requestAnimationFrame(() => {
                          textarea?.focus();
                          textarea?.setSelectionRange(
                            inserted.cursor,
                            inserted.cursor,
                          );
                        });
                      };
                      return (
                        <>
                          <Textarea
                            ref={(element) => {
                              templateRefs.current[key] = element;
                            }}
                            aria-label={copy[key]}
                            className="max-h-96 min-h-40 overflow-y-auto font-mono text-xs"
                            value={template}
                            maxLength={60000}
                            onChange={(e) => change({ [key]: e.target.value })}
                          />
                          <div
                            className="flex flex-wrap gap-2"
                            aria-label={copy.insertVariable}
                          >
                            {entry.variables.map((name) => (
                              <Button
                                key={name}
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => insertVariable(name)}
                              >
                                + {`{{${name}}}`}
                              </Button>
                            ))}
                          </div>
                          {missing.length > 0 && (
                            <p
                              role="alert"
                              className="text-xs text-destructive"
                            >
                              {copy.missingVariables}:{" "}
                              {missing.map((name) => `{{${name}}}`).join(" · ")}
                            </p>
                          )}
                          {unknown.length > 0 && (
                            <p
                              role="alert"
                              className="break-all text-xs text-destructive"
                            >
                              {copy.unknownVariables}:{" "}
                              {unknown.map((name) => `{{${name}}}`).join(" · ")}
                            </p>
                          )}
                          <details className="text-xs">
                            <summary className="cursor-pointer">
                              {copy.templatePreview}
                            </summary>
                            <p className="mt-2 text-muted-foreground">
                              {copy.templatePreviewHelp}
                            </p>
                            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded border p-3">
                              {previewTemplateVariables(template)}
                            </pre>
                          </details>
                          <details className="text-xs">
                            <summary className="cursor-pointer">
                              {copy.defaultTemplate}
                            </summary>
                            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded border p-3">
                              {entry[key]}
                            </pre>
                          </details>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => change({ [key]: entry[key] })}
                          >
                            {copy.useDefault}
                          </Button>
                        </>
                      );
                    })()}
                  </div>,
                ),
              )}
            </div>
          </TabsContent>
          <TabsContent
            value="runtime"
            className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pt-2 pr-1 pb-2"
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              {copy.agentRuntimeHelp}
            </p>
            {card(
              copy.agentRuntimeSection,
              <div className="space-y-4">
                <ConfigurationField
                  label={copy.model}
                  copy={copy}
                  source={source(`agents.${entry.id}.model`)}
                  overridden={"model" in local || "channelId" in local}
                  onInherit={() => reset(["model", "channelId"])}
                >
                  <NativeSelect
                    aria-label={copy.model}
                    className="min-h-10"
                    value={
                      agent.channelId && agent.model
                        ? `${agent.channelId}::${agent.model}`
                        : ""
                    }
                    onChange={(e) => {
                      if (!e.target.value) reset(["model", "channelId"]);
                      else {
                        const model = textModels.find(
                          (item) =>
                            `${item.channelId}::${item.modelId}` ===
                            e.target.value,
                        );
                        if (model)
                          change({
                            channelId: model.channelId,
                            model: model.modelId,
                          });
                      }
                    }}
                  >
                    <option value="">{copy.inherited}</option>
                    {agent.channelId &&
                      agent.model &&
                      !textModels.some(
                        (item) =>
                          item.channelId === agent.channelId &&
                          item.modelId === agent.model,
                      ) && (
                        <option value={`${agent.channelId}::${agent.model}`}>
                          {agent.model} ({agent.channelId})
                        </option>
                      )}
                    {textModels.map((model) => (
                      <option
                        key={model.id}
                        value={`${model.channelId}::${model.modelId}`}
                      >
                        {model.channelName} · {model.name}
                      </option>
                    ))}
                  </NativeSelect>
                  {!textModels.length && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {copy.unavailable}
                    </p>
                  )}
                </ConfigurationField>
                {field(
                  "fallbackModel",
                  <div className="space-y-2">
                    <NativeSelect
                      aria-label={copy.fallbackModel}
                      className="min-h-10"
                      value={
                        agent.fallbackChannelId && agent.fallbackModel
                          ? `${agent.fallbackChannelId}::${agent.fallbackModel}`
                          : ""
                      }
                      onChange={(e) => {
                        if (!e.target.value)
                          reset(["fallbackModel", "fallbackChannelId"]);
                        else {
                          const model = textModels.find(
                            (item) =>
                              `${item.channelId}::${item.modelId}` ===
                              e.target.value,
                          );
                          if (model)
                            change({
                              fallbackChannelId: model.channelId,
                              fallbackModel: model.modelId,
                            });
                        }
                      }}
                    >
                      <option value="">{copy.inherited}</option>
                      {agent.fallbackChannelId &&
                        agent.fallbackModel &&
                        !textModels.some(
                          (model) =>
                            model.channelId === agent.fallbackChannelId &&
                            model.modelId === agent.fallbackModel,
                        ) && (
                          <option
                            value={`${agent.fallbackChannelId}::${agent.fallbackModel}`}
                          >
                            {agent.fallbackModel} ({agent.fallbackChannelId})
                          </option>
                        )}
                      {textModels
                        .filter(
                          (model) =>
                            model.channelId !== agent.channelId ||
                            model.modelId !== agent.model,
                        )
                        .map((model) => (
                          <option
                            key={model.id}
                            value={`${model.channelId}::${model.modelId}`}
                          >
                            {model.channelName} · {model.name}
                          </option>
                        ))}
                    </NativeSelect>
                    <p className="text-xs text-muted-foreground">
                      {copy.fallbackHelp}
                    </p>
                  </div>,
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  {field(
                    "temperature",
                    <Input
                      aria-label={copy.temperature}
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={agent.temperature ?? ""}
                      placeholder={copy.inherited}
                      onChange={(e) =>
                        e.target.value === ""
                          ? reset(["temperature"])
                          : change({ temperature: Number(e.target.value) })
                      }
                    />,
                  )}
                  {field(
                    "maxCorrections",
                    <Input
                      aria-label={copy.corrections}
                      type="number"
                      min={0}
                      max={2}
                      value={agent.maxCorrections ?? ""}
                      placeholder={copy.inherited}
                      onChange={(e) =>
                        e.target.value === ""
                          ? reset(["maxCorrections"])
                          : change({ maxCorrections: Number(e.target.value) })
                      }
                    />,
                  )}
                </div>
              </div>,
            )}
            {card(
              copy.agentPermissionsSection,
              <div className="space-y-4">
                {entry.id === PROMPT_IDS.STUDIO_WORKFLOW_AGENT ? (
                  field(
                    "contextScopes",
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2">
                        {contextOptions.map(([scope, label]) => (
                          <label
                            key={scope}
                            className="flex min-h-10 cursor-pointer items-start gap-3 rounded-lg border p-3 text-xs leading-relaxed"
                          >
                            <Checkbox
                              checked={(
                                agent.contextScopes ??
                                DEFAULT_STUDIO_AGENT_CONTEXT_SCOPES
                              ).includes(scope)}
                              onCheckedChange={(checked) => {
                                const selected = new Set(
                                  agent.contextScopes ??
                                    DEFAULT_STUDIO_AGENT_CONTEXT_SCOPES,
                                );
                                if (checked === true) selected.add(scope);
                                else selected.delete(scope);
                                change({ contextScopes: [...selected] });
                              }}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {copy.contextScopesHelp}
                      </p>
                    </div>,
                  )
                ) : (
                  <p className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                    {copy.contextAgentOnly}
                  </p>
                )}
                {!!entry.tools.length &&
                  field(
                    "disabledOperations",
                    <div className="grid gap-2 sm:grid-cols-2">
                      {entry.tools.map((tool) => (
                        <label
                          key={tool}
                          className="flex min-h-10 cursor-pointer items-start gap-3 break-anywhere rounded-lg border p-3 text-xs leading-relaxed"
                        >
                          <Checkbox
                            checked={!agent.disabledOperations?.includes(tool)}
                            onCheckedChange={(checked) =>
                              change({
                                disabledOperations:
                                  checked === true
                                    ? (agent.disabledOperations ?? []).filter(
                                        (item) => item !== tool,
                                      )
                                    : [
                                        ...new Set([
                                          ...(agent.disabledOperations ?? []),
                                          tool,
                                        ]),
                                      ],
                              })
                            }
                          />
                          {tool}
                        </label>
                      ))}
                    </div>,
                  )}
              </div>,
            )}
            {entry.id === PROMPT_IDS.STUDIO_WORKFLOW_AGENT &&
              testScope?.projectId && (
                <AgentTestRunner
                  projectId={testScope.projectId}
                  scope={testScope}
                  agents={agents}
                  copy={copy}
                />
              )}
            {entry.id === PROMPT_IDS.STUDIO_WORKFLOW_AGENT &&
              !testScope?.projectId && (
                <p className="rounded-xl border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
                  {copy.agentTestUnavailable}
                </p>
              )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
