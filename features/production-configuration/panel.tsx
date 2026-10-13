"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ModelOption } from "@/components/agent/shell/chat-shell-types";
import {
  mergeProductionConfigurations,
  productionConfigurationPatchSchema,
  soundPolicyAudioMode,
  soundPolicyInstructions,
  type ConfigurationScope,
  type ProductionConfigurationPatch,
  type ProductionConfigurationSnapshot,
} from "@/lib/production-configuration/contract";
import { AgentEditor, type ConfigurationAgent } from "./agent-editor";
import { SoundEditor } from "./sound-editor";
import { ConfigurationField, selectClass } from "./fields";
import { productionCopy } from "./copy";
import { configurationDiff } from "./view-model";

type Version = {
  version: number;
  configuration: ProductionConfigurationPatch;
  note: string;
  authorId?: string;
  createdAt: string;
};
type ConfigurationRecord = {
  scopeKey: string;
  revision: number;
  version: number;
  draft: ProductionConfigurationPatch;
  published: ProductionConfigurationPatch | null;
  effective: ProductionConfigurationSnapshot;
  inherited: ProductionConfigurationSnapshot;
  history: Version[];
};
export type ProductionPanelStatus = { dirty: boolean; busy: boolean };

export function ProductionConfigurationPanel({
  locale,
  models,
  scope: available = {},
  onStatusChange,
}: {
  locale: "en" | "zh-CN";
  models: ModelOption[];
  scope?: ConfigurationScope;
  onStatusChange: (status: ProductionPanelStatus) => void;
}) {
  const copy = productionCopy[locale];
  const [scopeLevel, setScopeLevel] = useState<
    "user" | "project" | "episode" | "panel"
  >(available.projectId ? "project" : "user");
  const [record, setRecord] = useState<ConfigurationRecord | null>(null);
  const [catalog, setCatalog] = useState<ConfigurationAgent[]>([]);
  const [draft, setDraft] = useState<ProductionConfigurationPatch>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [note, setNote] = useState("");
  const [reload, setReload] = useState(0);
  const scope: ConfigurationScope = {
    ...(scopeLevel !== "user" ? { projectId: available.projectId } : {}),
    ...(scopeLevel === "episode" || scopeLevel === "panel"
      ? { episodeId: available.episodeId }
      : {}),
    ...(scopeLevel === "panel" ? { panelId: available.panelId } : {}),
  };
  const scopeJson = JSON.stringify(scope);
  const dirty =
    record !== null && configurationDiff(record.draft, draft).length > 0;
  const preview = mergeProductionConfigurations([
    record?.inherited ?? {},
    draft,
  ]);
  const validation = productionConfigurationPatchSchema.safeParse(draft);
  const valid = validation.success;

  useEffect(() => {
    onStatusChange({ dirty, busy: busy || loading });
  }, [dirty, busy, loading, onStatusChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(
      JSON.parse(scopeJson) as Record<string, string>,
    );
    setRecord(null);
    setDraft({});
    setNotice("");
    void fetch(`/api/settings/production?${params}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? copy.error);
        return data as {
          configuration: ConfigurationRecord;
          agents: ConfigurationAgent[];
        };
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setRecord(data.configuration);
        setDraft(data.configuration.draft);
        setCatalog(data.agents);
        setError("");
        setLoading(false);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setRecord(null);
          setDraft({});
          setError(reason instanceof Error ? reason.message : copy.error);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [scopeJson, reload, copy.error]);

  async function mutate(
    action: "save" | "publish" | "restore",
    restoreVersion?: number,
  ) {
    if (!record || busy || !valid) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/settings/production", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          action,
          expectedRevision: record.revision,
          ...(action !== "restore" ? { patch: draft } : { restoreVersion }),
          note,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? copy.conflict
            : (data.message ?? copy.error),
        );
      setRecord(data.configuration);
      setDraft(data.configuration.draft);
      setNote("");
      setNotice(
        action === "save"
          ? copy.saved
          : `${copy.published} · v${data.configuration.version}`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.error);
    } finally {
      setBusy(false);
    }
  }
  const source = (field: string) => {
    const origin = [...(record?.inherited.sources ?? [])]
      .reverse()
      .find((item) => item.fields?.includes(field));
    if (!origin) return copy.default;
    const level = origin.scopeKey.split(":")[0] as keyof typeof copy;
    return `${copy[level] ?? origin.scopeKey} v${origin.version}`;
  };
  function reloadData() {
    if (dirty && !window.confirm(copy.discard)) return;
    setLoading(true);
    setRecord(null);
    setDraft({});
    setError("");
    setNotice("");
    setReload((value) => value + 1);
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="min-w-40 flex-1 space-y-1 text-sm font-medium">
          {copy.scope}
          <select
            className={selectClass}
            value={scopeLevel}
            disabled={busy || loading}
            onChange={(e) => {
              if (dirty && !window.confirm(copy.discard)) return;
              setLoading(true);
              setNotice("");
              setScopeLevel(e.target.value as typeof scopeLevel);
            }}
          >
            <option value="user">{copy.user}</option>
            {available.projectId && (
              <option value="project">{copy.project}</option>
            )}
            {available.episodeId && (
              <option value="episode">{copy.episode}</option>
            )}
            {available.panelId && <option value="panel">{copy.panel}</option>}
          </select>
        </label>
        <span className="text-xs text-muted-foreground">
          {copy.version}: {record ? `v${record.version}` : "—"}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={reloadData}
        >
          {copy.reload}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{copy.description}</p>
      {error && (
        <p
          role="alert"
          className="break-words rounded border border-destructive/40 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <p
        role="status"
        aria-live="polite"
        className="text-xs text-muted-foreground"
      >
        {loading
          ? copy.loading
          : busy
            ? copy.saving
            : dirty
              ? copy.unsaved
              : notice || (record ? copy.saved : "")}
      </p>
      {record && !loading && (
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <Tabs defaultValue="sound" className="min-w-0">
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="sound">{copy.sound}</TabsTrigger>
              <TabsTrigger value="agents">{copy.agents}</TabsTrigger>
              <TabsTrigger value="workflow">{copy.workflow}</TabsTrigger>
              <TabsTrigger value="versions">{copy.versions}</TabsTrigger>
            </TabsList>
            <TabsContent value="sound" className="pt-3">
              <SoundEditor
                sound={preview.sound}
                patch={draft.sound ?? {}}
                onChange={(sound) => setDraft({ ...draft, sound })}
                source={source}
                copy={copy}
              />
            </TabsContent>
            <TabsContent value="agents" className="pt-3">
              <AgentEditor
                catalog={catalog}
                agents={preview.agents}
                patch={draft.agents ?? {}}
                onChange={(agents) => setDraft({ ...draft, agents })}
                models={models}
                source={source}
                copy={copy}
              />
            </TabsContent>
            <TabsContent value="workflow" className="space-y-4 pt-3">
              <ConfigurationField
                label={copy.retryMode}
                copy={copy}
                source={source("workflow.retryMode")}
                overridden={"retryMode" in (draft.workflow ?? {})}
                onInherit={() => {
                  const workflow = { ...draft.workflow };
                  delete workflow.retryMode;
                  setDraft({ ...draft, workflow });
                }}
              >
                <select
                  aria-label={copy.retryMode}
                  className={selectClass}
                  value={preview.workflow.retryMode}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      workflow: {
                        ...draft.workflow,
                        retryMode: e.target.value as "continue" | "restart",
                      },
                    })
                  }
                >
                  <option value="continue">{copy.retryContinue}</option>
                  <option value="restart">{copy.retryRestart}</option>
                </select>
              </ConfigurationField>
              {(
                [
                  "concurrency",
                  "requestTimeoutSeconds",
                  "transportAttempts",
                  "maxCorrections",
                ] as const
              ).map((key) => (
                <ConfigurationField
                  key={key}
                  label={
                    key === "concurrency"
                      ? copy.concurrency
                      : key === "requestTimeoutSeconds"
                        ? copy.timeout
                        : key === "transportAttempts"
                          ? copy.attempts
                          : copy.corrections
                  }
                  copy={copy}
                  source={source(`workflow.${key}`)}
                  overridden={key in (draft.workflow ?? {})}
                  onInherit={() => {
                    const workflow = { ...draft.workflow };
                    delete workflow[key];
                    setDraft({ ...draft, workflow });
                  }}
                >
                  <Input
                    aria-label={
                      key === "concurrency"
                        ? copy.concurrency
                        : key === "requestTimeoutSeconds"
                          ? copy.timeout
                          : key === "transportAttempts"
                            ? copy.attempts
                            : copy.corrections
                    }
                    type="number"
                    min={
                      key === "concurrency"
                        ? 1
                        : key === "requestTimeoutSeconds"
                          ? 10
                          : key === "transportAttempts"
                            ? 1
                            : 0
                    }
                    max={
                      key === "concurrency"
                        ? 8
                        : key === "requestTimeoutSeconds"
                          ? 3600
                          : key === "transportAttempts"
                            ? 5
                            : 2
                    }
                    value={preview.workflow[key]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        workflow: {
                          ...draft.workflow,
                          [key]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </ConfigurationField>
              ))}
              <p className="text-xs text-muted-foreground">{copy.policyHelp}</p>
            </TabsContent>
            <TabsContent value="versions" className="space-y-3 pt-3">
              <p className="text-xs text-muted-foreground">
                {copy.historyHelp}
              </p>
              {!record.history.length && <p>{copy.noVersions}</p>}
              {[...record.history].reverse().map((item) => (
                <div key={item.version} className="space-y-2 border-b py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        v{item.version}{" "}
                        {item.version === record.version
                          ? `· ${copy.active}`
                          : ""}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">
                        {copy.at}:{" "}
                        {new Date(item.createdAt).toLocaleString(locale)} ·{" "}
                        {copy.author}: {item.authorId ?? "—"}
                      </p>
                      <p className="break-words text-sm">{item.note}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={item.version === record.version}
                      onClick={() => {
                        if (dirty && !window.confirm(copy.discard)) return;
                        void mutate("restore", item.version);
                      }}
                    >
                      {copy.restore}
                    </Button>
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer">{copy.compare}</summary>
                    <div className="space-y-2 pt-2">
                      {configurationDiff(
                        item.configuration,
                        record.published ?? {},
                      ).map((change) => (
                        <div
                          key={change.field}
                          className="break-words border-l-2 pl-2"
                        >
                          <p className="font-mono">{change.field}</p>
                          <p className="whitespace-pre-wrap">
                            {JSON.stringify(change.before) ?? copy.inherited} →{" "}
                            {JSON.stringify(change.after) ?? copy.inherited}
                          </p>
                        </div>
                      ))}
                      {!configurationDiff(
                        item.configuration,
                        record.published ?? {},
                      ).length && <p>{copy.noChanges}</p>}
                    </div>
                  </details>
                </div>
              ))}
            </TabsContent>
          </Tabs>
          <details className="rounded border p-3 text-xs">
            <summary className="cursor-pointer font-medium">
              {copy.preview}
            </summary>
            <p className="mt-3 font-mono">
              {copy.audioParameter}: {soundPolicyAudioMode(preview.sound)}
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-words">
              {soundPolicyInstructions(
                preview.sound,
                locale === "en" ? "en" : "zh",
              )}
            </pre>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words">
              {JSON.stringify(preview, null, 2)}
            </pre>
          </details>
          {!valid && (
            <p role="alert" className="text-xs text-destructive">
              {validation.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")}
            </p>
          )}
          <label className="block space-y-1 text-sm">
            {copy.note}
            <Input
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy || !valid}
              onClick={() => void mutate("save")}
            >
              {copy.save}
            </Button>
            <Button
              disabled={busy || !valid}
              onClick={() => void mutate("publish")}
            >
              {copy.publish}
            </Button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
