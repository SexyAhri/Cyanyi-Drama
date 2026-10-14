"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Bot, RefreshCw, Volume2 } from "lucide-react";
import { useStudioConfirmation } from "@/features/studio/components/use-studio-confirmation";
import type { ModelOption } from "@/components/agent/shell/chat-shell-types";
import {
  mergeProductionConfigurations,
  productionConfigurationPatchSchema,
  type ConfigurationScope,
  type ProductionConfigurationPatch,
  type ProductionConfigurationSnapshot,
} from "@/lib/production-configuration/contract";
import { AgentEditor, type ConfigurationAgent } from "./agent-editor";
import { SoundEditor } from "./sound-editor";
import { productionCopy } from "./copy";
import { confirmConfigurationDiscard } from "./confirmation";
import { configurationDiff } from "./view-model";
import { ProductionConflictPanel } from "./conflict-panel";
import { validateAgentTemplateVariables } from "@/lib/production-configuration/template-variables";
import {
  managementPatch,
  type ProductionManagementSection,
} from "@/lib/production-configuration/management";
import {
  resolveProductionScopeLevel,
  type ProductionScopeLevel,
} from "./scope-state";

type ConfigurationRecord = {
  scopeKey: string;
  revision: number;
  version: number;
  draft: ProductionConfigurationPatch;
  published: ProductionConfigurationPatch | null;
  effective: ManagementValues;
  inherited: ManagementValues;
};
type ManagementValues = Pick<
  ProductionConfigurationSnapshot,
  "agents" | "sources"
> & {
  sound: Pick<ProductionConfigurationSnapshot["sound"], "mode">;
};
const EMPTY_SCOPE: ConfigurationScope = {};
export type ProductionPanelStatus = { dirty: boolean; busy: boolean };

export function ProductionConfigurationPanel({
  locale,
  models,
  scope: availableInput,
  onStatusChange,
  section = "agents",
}: {
  locale: "en" | "zh-CN";
  models: ModelOption[];
  scope?: ConfigurationScope;
  onStatusChange: (status: ProductionPanelStatus) => void;
  section?: ProductionManagementSection;
}) {
  const available = availableInput ?? EMPTY_SCOPE;
  const copy = productionCopy[locale];
  const { confirm, confirmationDialog } = useStudioConfirmation(locale);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedScopeLevel =
    section === "sound" ? searchParams.get("configScope") : "user";
  const [scopeLevel, setScopeLevel] = useState<ProductionScopeLevel>(() =>
    resolveProductionScopeLevel(requestedScopeLevel, available),
  );
  const [record, setRecord] = useState<ConfigurationRecord | null>(null);
  const [catalog, setCatalog] = useState<ConfigurationAgent[]>([]);
  const [draft, setDraft] = useState<ProductionConfigurationPatch>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyOperation, setBusyOperation] = useState<"save" | "compare">(
    "save",
  );
  const [hasConflict, setHasConflict] = useState(false);
  const [latest, setLatest] = useState<ConfigurationRecord | null>(null);
  const [comparisonKey, setComparisonKey] = useState(0);
  const pendingMutation = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const scope: ConfigurationScope =
    section === "agents"
      ? {}
      : {
          ...(scopeLevel !== "user" ? { projectId: available.projectId } : {}),
          ...(scopeLevel === "episode" || scopeLevel === "panel"
            ? { episodeId: available.episodeId }
            : {}),
          ...(scopeLevel === "panel" ? { panelId: available.panelId } : {}),
        };
  const scopeJson = JSON.stringify(scope);
  useEffect(() => {
    const resolved = resolveProductionScopeLevel(
      requestedScopeLevel,
      available,
    );
    setScopeLevel(resolved);
    if (
      section === "sound" &&
      requestedScopeLevel &&
      requestedScopeLevel !== resolved
    ) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("configScope", resolved);
      router.replace(`${pathname}?${params}`, { scroll: false });
    }
  }, [available, pathname, requestedScopeLevel, router, searchParams, section]);
  const dirty =
    hasConflict ||
    (record !== null &&
      configurationDiff(managementPatch(record.draft, section), draft).length >
        0);
  const preview = mergeProductionConfigurations([
    record?.inherited ?? {},
    draft,
  ]);
  const validation = productionConfigurationPatchSchema.safeParse(draft);
  const valid = validation.success;
  const agentValidationError =
    validateAgentTemplateVariables(draft.agents ?? {}, catalog) ?? "";

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
    setHasConflict(false);
    setLatest(null);
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
        setDraft(managementPatch(data.configuration.draft, section));
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
  }, [scopeJson, reload, copy.error, section]);

  async function readLatestForComparison() {
    setLatest(null);
    setComparisonKey((value) => value + 1);
    setBusyOperation("compare");
    const params = new URLSearchParams(
      JSON.parse(scopeJson) as Record<string, string>,
    );
    try {
      const response = await fetch(`/api/settings/production?${params}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? copy.error);
      if (data.configuration.scopeKey !== record?.scopeKey)
        throw new Error(copy.error);
      setLatest(data.configuration);
      setCatalog(data.agents);
    } catch {
      setError(copy.conflictReadFailed);
    }
  }

  async function retryComparison() {
    if (pendingMutation.current || busy || !record) return;
    pendingMutation.current = true;
    setBusy(true);
    setError(copy.conflict);
    try {
      await readLatestForComparison();
    } finally {
      pendingMutation.current = false;
      setBusy(false);
    }
  }

  async function confirmDiscard(description = copy.discard, confirmLabel = copy.discardChanges) {
    return confirmConfigurationDiscard({ dirty, busy }, confirm, copy, { description, confirmLabel });
  }

  async function acceptComparison(
    patch: ProductionConfigurationPatch,
    discard = false,
  ) {
    if (!latest || busy) return;
    if (discard && !(await confirmDiscard(copy.conflictDiscard, copy.conflictUseRemote))) return;
    setRecord(latest);
    setDraft(managementPatch(patch, section));
    setLatest(null);
    setHasConflict(false);
    setError("");
    setNotice(discard ? copy.saved : copy.conflictMerged);
  }

  async function mutate(action: "save" | "publish") {
    if (!record || busy || hasConflict || pendingMutation.current || !valid)
      return false;
    pendingMutation.current = true;
    setBusyOperation("save");
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
          patch: draft,
          section,
        }),
      });
      const data = await response.json();
      if (response.status === 409) {
        setHasConflict(true);
        setError(copy.conflict);
        await readLatestForComparison();
        return false;
      }
      if (!response.ok) throw new Error(data.message ?? copy.error);
      setRecord(data.configuration);
      setDraft(managementPatch(data.configuration.draft, section));
      setNotice(
        action === "save"
          ? copy.saved
          : `${copy.published} · v${data.configuration.version}`,
      );
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.error);
      return false;
    } finally {
      pendingMutation.current = false;
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
  async function reloadData() {
    if (dirty && !(await confirmDiscard())) return;
    setLoading(true);
    setRecord(null);
    setDraft({});
    setError("");
    setNotice("");
    setReload((value) => value + 1);
  }

  const isAgentManagement = section === "agents";
  const title = isAgentManagement ? copy.agentManagement : copy.mode;
  const Icon = isAgentManagement ? Bot : Volume2;

  return (
    <div
      className={
        isAgentManagement
          ? "flex h-full min-h-0 min-w-0 flex-col gap-3"
          : "min-w-0 space-y-4"
      }
    >
      <div className="shrink-0 rounded-xl border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{title}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {isAgentManagement ? copy.agentGlobalScope : copy.description}
              </p>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {!isAgentManagement && (
              <label className="flex w-full items-center gap-2 text-xs font-medium sm:w-48">
                <span className="shrink-0 text-muted-foreground">
                  {copy.scope}
                </span>
                <NativeSelect
                  value={scopeLevel}
                  aria-label={copy.scope}
                  disabled={busy || loading}
                  onChange={async (e) => {
                    const nextScope = e.currentTarget.value as ProductionScopeLevel;
                    if (nextScope === scopeLevel || (dirty && !(await confirmDiscard()))) return;
                    setLoading(true);
                    setNotice("");
                    setScopeLevel(nextScope);
                    const params = new URLSearchParams(searchParams.toString());
                    params.set("configScope", nextScope);
                    router.replace(`${pathname}?${params}`, { scroll: false });
                  }}
                >
                  <option value="user">{copy.user}</option>
                  {available.projectId && (
                    <option value="project">{copy.project}</option>
                  )}
                  {available.episodeId && (
                    <option value="episode">{copy.episode}</option>
                  )}
                  {available.panelId && (
                    <option value="panel">{copy.panel}</option>
                  )}
                </NativeSelect>
              </label>
            )}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={copy.reload}
              disabled={busy || loading}
              onClick={() => void reloadData()}
            >
              <RefreshCw className="size-4" />
            </Button>
            {record && !loading && !hasConflict && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-10 flex-1 sm:flex-none"
                  disabled={busy || !valid}
                  onClick={() => void mutate("save")}
                >
                  {copy.save}
                </Button>
                <Button
                  type="button"
                  className="min-h-10 flex-1 sm:flex-none"
                  disabled={busy || !valid || Boolean(agentValidationError)}
                  onClick={() => void mutate("publish")}
                >
                  {copy.publish}
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <p role="status" aria-live="polite">
            {loading
              ? copy.loading
              : busy
                ? busyOperation === "compare"
                  ? copy.conflictReading
                  : copy.saving
                : dirty
                  ? copy.unsaved
                  : notice ||
                    (record
                      ? record.revision === 0
                        ? copy.default
                        : copy.saved
                      : "")}
          </p>
          <span>
            {copy.version}: {record ? `v${record.version}` : "—"}
          </span>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="break-anywhere rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {agentValidationError && (
        <p
          role="alert"
          className="break-anywhere rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {copy.publishBlocked}: {agentValidationError}
        </p>
      )}
      {hasConflict && record && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ProductionConflictPanel
            key={comparisonKey}
            copy={copy}
            base={managementPatch(record.draft, section)}
            local={draft}
            remote={latest ? managementPatch(latest.draft, section) : null}
            revision={latest?.revision}
            version={latest?.version}
            agentNames={Object.fromEntries(
              catalog.map((agent) => [agent.id, agent.name]),
            )}
            busy={busy}
            onRefresh={() => void retryComparison()}
            onMerge={(patch) => void acceptComparison(patch)}
            onUseRemote={() => {
              if (latest) void acceptComparison(latest.draft, true);
            }}
          />
        </div>
      )}
      {record && !loading && !hasConflict && (
        <fieldset
          disabled={busy}
          className={
            isAgentManagement
              ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              : "min-w-0 space-y-4"
          }
        >
          {isAgentManagement ? (
            <AgentEditor
              catalog={catalog}
              agents={preview.agents}
              patch={draft.agents ?? {}}
              onChange={(agents) => setDraft({ agents })}
              models={models}
              source={source}
              copy={copy}
              testScope={available}
            />
          ) : (
            <>
              <SoundEditor
                sound={preview.sound}
                patch={draft.sound ?? {}}
                onChange={(sound) => setDraft({ sound })}
                source={source}
                copy={copy}
              />
            </>
          )}
          {!valid && (
            <p role="alert" className="break-anywhere text-xs text-destructive">
              {validation.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")}
            </p>
          )}
        </fieldset>
      )}
      {confirmationDialog}
    </div>
  );
}
