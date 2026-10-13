"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ModelOption } from "@/components/agent/shell/chat-shell-types";
import type { AgentConfiguration } from "@/lib/production-configuration/contract";
import type { getConfigurationAgentCatalog } from "@/lib/production-configuration/agents";
import { ConfigurationField, selectClass } from "./fields";
import type { ProductionCopy } from "./copy";
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
}: {
  catalog: ConfigurationAgent[];
  agents: Record<string, AgentConfiguration>;
  patch: Record<string, AgentConfiguration>;
  onChange: (patch: Record<string, AgentConfiguration>) => void;
  models: ModelOption[];
  source: (field: string) => string;
  copy: ProductionCopy;
}) {
  const [selected, setSelected] = useState("");
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
      source={source(`agents.${entry.id}.${key}`)}
      overridden={key in local}
      onInherit={() => reset([key])}
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
  return (
    <div className="space-y-4">
      <label className="block space-y-1 text-sm font-medium">
        {copy.agent}
        <select
          className={selectClass}
          value={entry.id}
          onChange={(e) => setSelected(e.target.value)}
        >
          {catalog.map((item) => (
            <option key={item.id} value={item.id}>
              {agents[item.id]?.name || item.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">{copy.agentHelp}</p>
      {field(
        "name",
        <Input
          aria-label={copy.name}
          value={agent.name ?? entry.name}
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
        "systemInstructions",
        <Textarea
          aria-label={copy.systemInstructions}
          value={agent.systemInstructions ?? ""}
          maxLength={16000}
          onChange={(e) => change({ systemInstructions: e.target.value })}
        />,
      )}
      <ConfigurationField
        label={copy.model}
        copy={copy}
        source={source(`agents.${entry.id}.model`)}
        overridden={"model" in local || "channelId" in local}
        onInherit={() => reset(["model", "channelId"])}
      >
        <select
          aria-label={copy.model}
          className={selectClass}
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
                  `${item.channelId}::${item.modelId}` === e.target.value,
              )!;
              change({ channelId: model.channelId, model: model.modelId });
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
        </select>
        {!textModels.length && (
          <p className="mt-1 text-xs text-muted-foreground">
            {copy.unavailable}
          </p>
        )}
      </ConfigurationField>
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
      <p className="break-words text-xs text-muted-foreground">
        {copy.variables}:{" "}
        {entry.variables.map((key) => `{{${key}}}`).join(" · ")}
      </p>
      {(["templateZh", "templateEn"] as const).map((key) =>
        field(
          key,
          <div className="space-y-2">
            <Textarea
              aria-label={copy[key]}
              className="max-h-96 min-h-40 overflow-y-auto font-mono text-xs"
              value={agent[key] ?? entry[key]}
              maxLength={60000}
              onChange={(e) => change({ [key]: e.target.value })}
            />
            <details className="text-xs">
              <summary className="cursor-pointer">
                {copy.defaultTemplate}
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded border p-3">
                {entry[key]}
              </pre>
            </details>
            <Button
              size="sm"
              variant="outline"
              onClick={() => change({ [key]: entry[key] })}
            >
              {copy.useDefault}
            </Button>
          </div>,
        ),
      )}
      {!!entry.tools.length &&
        field(
          "disabledOperations",
          <div className="grid gap-2 sm:grid-cols-2">
            {entry.tools.map((tool) => (
              <label
                key={tool}
                className="flex items-center gap-2 break-all text-xs"
              >
                <input
                  type="checkbox"
                  checked={!agent.disabledOperations?.includes(tool)}
                  onChange={(e) =>
                    change({
                      disabledOperations: e.target.checked
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
    </div>
  );
}
