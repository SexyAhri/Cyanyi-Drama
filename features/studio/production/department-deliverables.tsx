"use client";

import {
  AlertTriangle,
  Archive,
  Check,
  FileCheck2,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Send,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MediaPreviewDialog } from "@/components/ui/media-preview-dialog";
import { cn } from "@/lib/utils";

import {
  loadStudioDeliverables,
  loadStudioProjectAssets,
  transitionStudioDeliverable,
} from "../api";
import { formatStudioDate } from "../i18n";
import type {
  ProductionDeliverableCatalog,
  ProductionDeliverableRecord,
  ProjectMediaAsset,
  StudioLocale,
  StudioSelectionContext,
} from "../types";
import { getProductionCopy, productionLabel } from "./copy";
import {
  filterProductionDeliverables,
  getDeliverableGuidance,
  getDeliverableBlockers,
  getNextPendingGate,
  payloadLines,
} from "./deliverable-view-model";
import {
  DeliverableConfirmDialog,
  DeliverableCreateDialog,
  DeliverableRejectDialog,
  getDeliverableTemplate,
} from "./deliverable-dialogs";

export function DepartmentDeliverablesWorkspace({
  defaultType,
  departments,
  episodeId,
  locale,
  onContextChange,
  projectId,
  sourceAssets: providedSourceAssets,
  title,
  types,
}: {
  defaultType: string;
  departments: string[];
  episodeId?: string;
  locale: StudioLocale;
  onContextChange: (selection?: StudioSelectionContext) => void;
  projectId: string;
  sourceAssets?: ProjectMediaAsset[];
  title: string;
  types?: string[];
}) {
  const copy = getProductionCopy(locale);
  const [catalog, setCatalog] = useState<ProductionDeliverableCatalog | null>(
    null,
  );
  const [sourceAssets, setSourceAssets] = useState<ProjectMediaAsset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const [nextCatalog, assets] = await Promise.all([
          loadStudioDeliverables(projectId, signal),
          providedSourceAssets
            ? Promise.resolve(providedSourceAssets)
            : loadStudioProjectAssets(projectId, signal),
        ]);
        if (!signal?.aborted) {
          setCatalog(nextCatalog);
          setSourceAssets(assets.filter((asset) => asset.kind === "image"));
        }
      } catch (requestError) {
        if (!signal?.aborted)
          setError(
            requestError instanceof Error
              ? requestError.message
              : copy.actionFailed,
          );
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [copy.actionFailed, projectId, providedSourceAssets],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const deliverables = useMemo(
    () =>
      catalog
        ? filterProductionDeliverables(
            catalog.deliverables,
            departments,
            types,
          )
        : [],
    [catalog, departments, types],
  );
  const selected =
    deliverables.find((deliverable) => deliverable.id === selectedId) ??
    deliverables[0];

  useEffect(() => {
    if (!deliverables.length) {
      setSelectedId("");
      return;
    }
    if (!deliverables.some((deliverable) => deliverable.id === selectedId))
      setSelectedId(deliverables[0].id);
  }, [deliverables, selectedId]);

  useEffect(() => {
    onContextChange(
      selected
        ? {
            id: selected.id,
            kind: "deliverable",
            label: selected.title,
            metadata: {
              department: selected.department,
              status: selected.status,
              version: selected.version,
            },
          }
        : undefined,
    );
  }, [onContextChange, selected]);

  async function transition(
    action: "submit" | "approve" | "reject" | "lock" | "supersede",
    input?: { gateKey?: string; note?: string },
  ) {
    if (!selected) return;
    setIsActing(true);
    try {
      await transitionStudioDeliverable(projectId, selected.id, {
        action,
        ...input,
      });
      toast.success(copy.updated);
      await load();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : copy.actionFailed,
      );
    } finally {
      setIsActing(false);
    }
  }

  if (isLoading && !catalog) {
    return (
      <div
        aria-label={copy.loading}
        className="flex min-h-80 items-center justify-center text-muted-foreground"
        role="status"
      >
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }

  if (!catalog || error) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center gap-3 border-y px-6 text-center">
        <p className="text-sm text-destructive">
          {error ?? copy.actionFailed}
        </p>
        <Button onClick={() => void load()} type="button" variant="outline">
          {copy.retry}
        </Button>
      </div>
    );
  }

  const visibleDepartments = catalog.departments.filter((department) =>
    departments.includes(department.id),
  );
  const visibleTypes = visibleDepartments
    .flatMap((department) => department.deliverableTypes)
    .filter((type) => !types || types.includes(type));

  return (
    <section className="border-y xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden">
      <header className="flex shrink-0 flex-col gap-3 border-b px-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {deliverables.length} {copy.deliverables}
          </p>
        </div>
        <DeliverableCreateDialog
          catalog={catalog}
          defaultType={defaultType}
          departments={departments}
          episodeId={episodeId}
          locale={locale}
          onCompleted={load}
          projectId={projectId}
          sourceAssets={sourceAssets}
          types={types}
        />
      </header>

      <div className="grid shrink-0 border-b bg-muted/20 md:grid-cols-2">
        {visibleDepartments.map((department) => (
          <div
            className="border-b px-4 py-3 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0"
            key={department.id}
          >
            <div className="flex items-center gap-2">
              <UsersRound className="size-4 text-muted-foreground" />
              <p className="text-xs font-semibold">
                {productionLabel(locale, "departments", department.id)}
              </p>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {copy.departmentLead}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {department.agents.map((agent) => (
                <Badge key={agent} variant="outline">
                  {productionLabel(locale, "agents", agent)}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!deliverables.length ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <FileCheck2 className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium">{copy.noDeliverables}</p>
          </div>
          <div className="divide-y">
            {visibleTypes.map((type) => (
              <div
                className="grid gap-2 py-3 sm:grid-cols-[13rem_minmax(0,1fr)_minmax(0,0.9fr)] sm:gap-4"
                key={type}
              >
                <div>
                  <p className="text-sm font-medium">
                    {productionLabel(locale, "types", type)}
                  </p>
                  <Badge className="mt-1.5" variant="outline">
                    {getDeliverableGuidance(locale, type).mode === "automatic"
                      ? copy.automaticUse
                      : copy.referenceUse}
                  </Badge>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {getDeliverableTemplate(locale, type).purpose}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  <strong className="font-medium text-foreground">
                    {copy.usedBy}：
                  </strong>
                  {getDeliverableGuidance(locale, type).usedBy}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid min-h-[34rem] lg:grid-cols-[18rem_minmax(0,1fr)] xl:min-h-0 xl:flex-1 xl:overflow-hidden">
          <aside className="border-b lg:border-r lg:border-b-0 xl:flex xl:min-h-0 xl:flex-col">
            <div className="max-h-80 overflow-y-auto p-1.5 xl:max-h-none xl:flex-1">
              {deliverables.map((deliverable) => (
                <button
                  className={cn(
                    "flex w-full min-w-0 items-start gap-3 rounded-md px-2.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    deliverable.id === selected?.id && "bg-muted",
                  )}
                  key={deliverable.id}
                  onClick={() => setSelectedId(deliverable.id)}
                  type="button"
                >
                  <span className="mt-0.5 w-8 shrink-0 font-mono text-[11px] text-muted-foreground">
                    v{deliverable.version}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {deliverable.title}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      {productionLabel(
                        locale,
                        "types",
                        deliverable.deliverableType,
                      )}
                    </span>
                  </span>
                  <DeliverableStatus
                    locale={locale}
                    status={deliverable.status}
                  />
                </button>
              ))}
            </div>
          </aside>

          {selected ? (
            <DeliverableDetail
              deliverable={selected}
              disabled={isActing}
              locale={locale}
              onTransition={transition}
              sourceAssets={sourceAssets}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}

function DeliverableDetail({
  deliverable,
  disabled,
  locale,
  onTransition,
  sourceAssets,
}: {
  deliverable: ProductionDeliverableRecord;
  disabled: boolean;
  locale: StudioLocale;
  onTransition: (
    action: "submit" | "approve" | "reject" | "lock" | "supersede",
    input?: { gateKey?: string; note?: string },
  ) => Promise<void>;
  sourceAssets: ProjectMediaAsset[];
}) {
  const copy = getProductionCopy(locale);
  const blockers = getDeliverableBlockers(deliverable);
  const guidance = getDeliverableGuidance(
    locale,
    deliverable.deliverableType,
  );
  const nextGate = getNextPendingGate(deliverable);
  const summary =
    typeof deliverable.payload.summary === "string"
      ? deliverable.payload.summary
      : "";
  const directives = payloadLines(deliverable.payload.directives);
  const constraints = payloadLines(deliverable.payload.constraints);
  const [previewAsset, setPreviewAsset] =
    useState<ProjectMediaAsset | null>(null);
  const sourceIds = new Set(
    deliverable.sourceRefs.flatMap((reference) => {
      if (!reference || typeof reference !== "object") return [];
      const id = (reference as Record<string, unknown>).id;
      return typeof id === "string" ? [id] : [];
    }),
  );
  const linkedSourceAssets = sourceAssets.filter((asset) =>
    sourceIds.has(asset.id),
  );

  return (
    <article className="min-w-0 p-4 sm:p-5 xl:min-h-0 xl:overflow-y-auto">
      <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{deliverable.title}</h3>
            <DeliverableStatus locale={locale} status={deliverable.status} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {productionLabel(
              locale,
              "types",
              deliverable.deliverableType,
            )}
            {" · "}
            {copy.version} {deliverable.version}
            {" · "}
            {formatStudioDate(locale, deliverable.updatedAt)}
          </p>
        </div>
        <DeliverableActions
          deliverable={deliverable}
          disabled={disabled}
          locale={locale}
          nextGate={nextGate?.key}
          onTransition={onTransition}
        />
      </header>

      <div className="grid gap-px border-b bg-border sm:grid-cols-3">
        <Metric
          label={copy.sources}
          value={`${deliverable.sourceRefs.length} ${copy.sourceCount}`}
        />
        <Metric
          label={copy.dependencies}
          value={
            blockers.length
              ? `${blockers.length} ${copy.blockers}`
              : copy.ready
          }
          warning={Boolean(blockers.length)}
        />
        <Metric label={copy.cost} value={deliverable.cost} />
      </div>

      <section className="grid gap-4 border-b py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
        <div>
          <p className="text-[11px] text-muted-foreground">{copy.summary}</p>
          <p className="mt-1 text-sm leading-6">{guidance.purpose}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">{copy.usedBy}</p>
          <p className="mt-1 text-sm leading-6">{guidance.usedBy}</p>
        </div>
        <Badge variant="outline">
          {guidance.mode === "automatic"
            ? copy.automaticUse
            : copy.referenceUse}
        </Badge>
      </section>

      {linkedSourceAssets.length ? (
        <section className="border-b py-4">
          <h4 className="text-xs font-semibold">{copy.sourceAssets}</h4>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
            {linkedSourceAssets.map((asset) => (
              <button
                aria-label={copy.sourceAssets}
                className="group relative aspect-square overflow-hidden rounded-md border bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                key={asset.id}
                onClick={() => setPreviewAsset(asset)}
                type="button"
              >
                {asset.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={copy.sourceAssets}
                    className="size-full object-cover"
                    src={asset.url}
                  />
                ) : null}
                <span className="absolute right-1.5 bottom-1.5 flex size-6 items-center justify-center rounded-md bg-black/65 text-white opacity-80 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">
                  <Maximize2 className="size-3" />
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {blockers.length ? (
        <div className="mt-4 border-l-2 border-destructive bg-destructive/5 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-destructive">
            <AlertTriangle className="size-4" />
            {copy.blockedDependency}
          </div>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {blockers.map((blocker) => (
              <li key={blocker.id}>
                {blocker.title} · v{blocker.requiredVersion} ·{" "}
                {productionLabel(locale, "statuses", blocker.status)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-6 py-5 2xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-5">
          <PayloadSection label={copy.creativeDirection} values={[summary]} />
          <PayloadSection label={copy.directives} values={directives} />
          <PayloadSection label={copy.constraints} values={constraints} />
        </div>
        <aside>
          <h4 className="text-xs font-semibold">{copy.approval}</h4>
          <div className="mt-2 divide-y border-y">
            {deliverable.approvalGates.map((gate) => (
              <div className="flex items-center gap-2 py-2.5" key={gate.key}>
                <span className="min-w-0 flex-1 truncate text-xs">
                  {productionLabel(locale, "gates", gate.key)}
                </span>
                <DeliverableStatus locale={locale} status={gate.status} />
              </div>
            ))}
          </div>
          <h4 className="mt-5 text-xs font-semibold">{copy.dependencies}</h4>
          {deliverable.dependencies.length ? (
            <div className="mt-2 divide-y border-y">
              {deliverable.dependencies.map((dependency) => (
                <div className="py-2.5" key={dependency.id}>
                  <p className="truncate text-xs font-medium">
                    {dependency.title}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    v{dependency.requiredVersion} ·{" "}
                    {productionLabel(locale, "statuses", dependency.status)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {copy.noDependencies}
            </p>
          )}
        </aside>
      </div>
      {previewAsset?.url ? (
        <MediaPreviewDialog
          alt={deliverable.title}
          description={deliverable.title}
          kind="image"
          onOpenChange={(open) => {
            if (!open) setPreviewAsset(null);
          }}
          open={Boolean(previewAsset)}
          title={deliverable.title}
          url={previewAsset.url}
        />
      ) : null}
    </article>
  );
}

function DeliverableActions({
  deliverable,
  disabled,
  locale,
  nextGate,
  onTransition,
}: {
  deliverable: ProductionDeliverableRecord;
  disabled: boolean;
  locale: StudioLocale;
  nextGate?: string;
  onTransition: (
    action: "submit" | "approve" | "reject" | "lock" | "supersede",
    input?: { gateKey?: string; note?: string },
  ) => Promise<void>;
}) {
  const copy = getProductionCopy(locale);
  if (["stale", "superseded"].includes(deliverable.status)) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {deliverable.status === "draft" ? (
        <Button
          disabled={disabled}
          onClick={() => void onTransition("submit")}
          size="sm"
          type="button"
        >
          <Send className="size-4" />
          {copy.submit}
        </Button>
      ) : null}
      {deliverable.status === "review" && nextGate ? (
        <>
          <DeliverableRejectDialog
            disabled={disabled}
            gateKey={nextGate}
            locale={locale}
            onReject={(note) => onTransition("reject", { gateKey: nextGate, note })}
          />
          <Button
            disabled={disabled}
            onClick={() =>
              void onTransition("approve", { gateKey: nextGate })
            }
            size="sm"
            type="button"
          >
            <Check className="size-4" />
            {copy.approve} · {productionLabel(locale, "gates", nextGate)}
          </Button>
        </>
      ) : null}
      {deliverable.status === "approved" ? (
        <DeliverableConfirmDialog
          description={copy.confirmLock}
          disabled={disabled}
          icon={<LockKeyhole className="size-4" />}
          label={copy.lock}
          locale={locale}
          onConfirm={() => onTransition("lock")}
        />
      ) : null}
      <DeliverableConfirmDialog
        description={copy.confirmSupersede}
        disabled={disabled}
        icon={<Archive className="size-4" />}
        label={copy.supersede}
        locale={locale}
        onConfirm={() => onTransition("supersede")}
        variant="outline"
      />
    </div>
  );
}

function DeliverableStatus({
  locale,
  status,
}: {
  locale: StudioLocale;
  status: string;
}) {
  return (
    <Badge
      className={cn(
        "shrink-0",
        status === "locked" && "border-emerald-600/30 text-emerald-700 dark:text-emerald-400",
        status === "stale" && "border-destructive/30 text-destructive",
      )}
      variant="outline"
    >
      {productionLabel(locale, "statuses", status)}
    </Badge>
  );
}

function Metric({
  label,
  value,
  warning,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className="bg-background px-3 py-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xs font-medium", warning && "text-destructive")}>
        {value}
      </p>
    </div>
  );
}

function PayloadSection({ label, values }: { label: string; values: string[] }) {
  const visible = values.filter(Boolean);
  if (!visible.length) return null;
  return (
    <section>
      <h4 className="text-xs font-semibold">{label}</h4>
      <div className="mt-2 space-y-2 border-l pl-3 text-sm leading-6 text-muted-foreground">
        {visible.map((value, index) => (
          <p key={`${index}-${value}`}>{value}</p>
        ))}
      </div>
    </section>
  );
}
