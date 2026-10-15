"use client";

import {
  Ban,
  CirclePause,
  CirclePlay,
  ListChecks,
  ListRestart,
  RotateCcw,
  ScanSearch,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  controlStudioMediaTask,
  controlStudioWorkflow,
  deleteStudioMediaTask,
  deleteStudioWorkflow,
  loadStudioMediaRetryPreview,
  retryStudioWorkflowStep,
} from "../api";
import type { MediaTaskRetryPreview } from "@/lib/media/retry-preview";
import { formatStudioDate } from "../i18n";
import { runtimeStatusToStageStatus } from "../stage-state";
import type { StudioLocale, WorkspaceSnapshot } from "../types";
import {
  mediaTaskOperationLabel,
  mediaTaskExecutionPhaseLabel,
  workflowStepOperationLabel,
} from "../workflow-labels";
import { StatusIndicator } from "../components/status-indicator";
import { RegenerationDialog } from "@/features/production-configuration/regeneration-dialog";
import {
  BulkRegenerationDialog,
  type BulkRegenerationTarget,
} from "@/features/production-configuration/bulk-regeneration-dialog";
import {
  buildOperationItems,
  isOperationDeletable,
  isOperationRetryable,
  isWorkflowRunRetryActionItem,
  operationErrorMessage,
  type OperationItem,
  workflowAttemptLabel,
  filterOperationItems,
  operationCauseKey,
  operationModelKey,
  operationPhaseKey,
  prioritizeFocusedOperation,
} from "./inspector-view-model";
import {
  downstreamRetryStepKeys,
  workflowRetryStepKeys,
} from "@/lib/workflow/retry-scope";

const copy = {
  "zh-CN": {
    active: "进行中",
    allModels: "全部模型",
    allPhases: "全部阶段",
    allCauses: "全部原因",
    actionFailed: "操作失败",
    cancel: "取消",
    confirmDelete: "确认删除",
    delete: "删除",
    deleteDescription:
      "将永久删除这条运行记录、Trace、步骤和重试历史，且无法撤销。已经写入项目的制作数据不会删除。",
    deleteSuccess: "运行记录已删除",
    deleteTitle: "删除运行记录？",
    empty: "当前剧集还没有运行记录",
    failed: "失败",
    filterLabel: "筛选失败任务",
    selectRetryable: "选择可重试项",
    selectedCount: "已选",
    continueSelected: "继续所选",
    regenerateSelected: "新配置重生成",
    bulkRetryTitle: "确认批量继续",
    bulkRetryDescription:
      "将按各记录的原始输入与配置依次继续；新增模型请求可能产生费用。",
    bulkRetryReady: "所有媒体请求已完成额度与预算预览。",
    bulkRetryBlocked: "请取消选择阻塞项，再继续其他任务。",
    bulkRetrySuccess: "所选记录已提交继续操作",
    bulkRetryPartial: "部分记录未能提交",
    inspect: "查看 Trace",
    pause: "暂停",
    resume: "恢复",
    retryTask: "重试此请求（沿用已保存设置）",
    retryWorkflow: "继续完成（复用成功检查点和原配置）",
    retryRun: "重试整条工作流",
    retryTitle: "确认重试范围",
    retryRequestScope: "将重试这 1 个请求，并沿用冻结的输入、模型和配置快照。",
    retrySavedOutputScope:
      "模型结果已保存到任务。重试只重新下载/保存结果，不会再次提交生成请求。",
    retryStepScope:
      "将重跑选中步骤及所有依赖它的后续步骤；保留其前置成功步骤。",
    retryRunScope:
      "将按当前工作流的失败/待处理步骤继续或重跑，并展示实际影响步骤。",
    retryTarget: "目标",
    retryStepCount: "影响步骤",
    retryMayCost: "重新发起模型请求可能产生费用。",
    confirmRetry: "确认重试",
    retryPreviewLoading: "正在读取任务快照、额度与预算…",
    retryPreviewFailed: "无法读取重试预览；请刷新后重试。",
    retryRequests: "预计新模型请求",
    retryCost: "预计平台额度占用",
    retryCostUnknown: "没有模型计价；费用未知",
    retryAvailable: "当前可用额度",
    retryProjectRemaining: "项目预算剩余",
    retryBatchRemaining: "批次预算剩余",
    regenerate: "使用新配置重新生成",
    workflowVersion: "编排版本",
  },
  en: {
    active: "Active",
    allModels: "All models",
    allPhases: "All phases",
    allCauses: "All causes",
    actionFailed: "Action failed",
    cancel: "Cancel",
    confirmDelete: "Delete",
    delete: "Delete",
    deleteDescription:
      "This permanently deletes the task record and its related data.",
    deleteSuccess: "Run record deleted",
    deleteTitle: "Delete run record?",
    empty: "No runs for this episode",
    failed: "Failed",
    filterLabel: "Filter failed operations",
    selectRetryable: "Select retryable items",
    selectedCount: "Selected",
    continueSelected: "Continue selected",
    regenerateSelected: "Regenerate with new settings",
    bulkRetryTitle: "Confirm bulk continuation",
    bulkRetryDescription:
      "Items will continue in sequence with their saved input and settings. Fresh provider requests may incur charges.",
    bulkRetryReady:
      "Credit and budget previews are ready for every media request.",
    bulkRetryBlocked:
      "Deselect blocked items before continuing the remaining tasks.",
    bulkRetrySuccess: "Continuation submitted for selected items",
    bulkRetryPartial: "Some selected items could not be submitted",
    inspect: "Inspect trace",
    pause: "Pause",
    resume: "Resume",
    retryTask: "Retry this request (saved settings)",
    retryWorkflow: "Continue from checkpoints (original settings)",
    retryRun: "Retry entire workflow",
    retryTitle: "Confirm retry scope",
    retryRequestScope:
      "Retry this one request with its frozen input, model, and configuration snapshot.",
    retrySavedOutputScope:
      "A model result is saved on this task. Retry only downloads/saves it; no new generation request is submitted.",
    retryStepScope:
      "Rerun this step and every dependent step; retain successful prerequisites.",
    retryRunScope:
      "Continue or rerun the failed/pending workflow steps and show the affected steps.",
    retryTarget: "Target",
    retryStepCount: "Affected steps",
    retryMayCost: "New model requests may incur cost.",
    confirmRetry: "Confirm retry",
    retryPreviewLoading:
      "Loading the saved request, credit, and budget details…",
    retryPreviewFailed:
      "Unable to load the retry preview. Refresh and try again.",
    retryRequests: "New provider requests",
    retryCost: "Estimated platform credit hold",
    retryCostUnknown: "No model price configured; cost is unknown",
    retryAvailable: "Available credits",
    retryProjectRemaining: "Project budget remaining",
    retryBatchRemaining: "Batch budget remaining",
    regenerate: "Regenerate with published settings",
    workflowVersion: "Workflow version",
  },
} as const;

type BulkContinueState = {
  batchId: string;
  items: OperationItem[];
  previews: Record<string, MediaTaskRetryPreview>;
  loading: boolean;
};

export function OperationsPanel({
  episodeId,
  locale,
  onRefresh,
  onTrace,
  focusOperationId,
  snapshot,
}: {
  episodeId?: string;
  locale: StudioLocale;
  onRefresh: () => Promise<unknown> | void;
  onTrace: (traceId: string) => void;
  focusOperationId?: string;
  snapshot: WorkspaceSnapshot;
}) {
  const text = copy[locale];
  const [busyId, setBusyId] = useState("");
  const [failureFilters, setFailureFilters] = useState({
    cause: "all",
    model: "all",
    phase: "all",
  });
  const [selectedOperationIds, setSelectedOperationIds] = useState<string[]>(
    [],
  );
  const [bulkContinue, setBulkContinue] = useState<BulkContinueState | null>(
    null,
  );
  const [bulkRegenerationTargets, setBulkRegenerationTargets] = useState<
    BulkRegenerationTarget[] | null
  >(null);
  const [deleteItem, setDeleteItem] = useState<OperationItem | null>(null);
  const [retryRequest, setRetryRequest] = useState<{
    item: OperationItem;
    scope: "request" | "step" | "run";
    preview: MediaTaskRetryPreview | null;
    previewLoading: boolean;
    previewError: string;
  } | null>(null);
  const [regenerateItem, setRegenerateItem] = useState<OperationItem | null>(
    null,
  );
  const items = useMemo(
    () => buildOperationItems(snapshot, episodeId),
    [episodeId, snapshot],
  );
  const filteredItems = useMemo(
    () => filterOperationItems(items, failureFilters),
    [failureFilters, items],
  );
  const prioritizedItems = useMemo(
    () => prioritizeFocusedOperation(filteredItems, focusOperationId),
    [filteredItems, focusOperationId],
  );
  const focusedRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOperationId)
      focusedRow.current?.scrollIntoView({ block: "nearest" });
  }, [focusOperationId, prioritizedItems]);
  const filterChoices = useMemo(
    () => ({
      causes: [
        ...new Set(
          items.map(operationCauseKey).filter((value) => value !== "none"),
        ),
      ].sort(),
      models: [
        ...new Set(
          items.filter((item) => item.kind === "task").map(operationModelKey),
        ),
      ].sort(),
      phases: [...new Set(items.map(operationPhaseKey))].sort(),
    }),
    [items],
  );
  const retryableItems = useMemo(
    () =>
      filteredItems.filter(
        (item) =>
          isOperationRetryable(item) &&
          (item.kind === "task" || isWorkflowRunRetryActionItem(item)),
      ),
    [filteredItems],
  );
  const selectedRetryableItems = retryableItems.filter((item) =>
    selectedOperationIds.includes(item.id),
  );
  const allVisibleSelected =
    retryableItems.length > 0 &&
    retryableItems.every((item) => selectedOperationIds.includes(item.id));
  const statuses = items.map((item) =>
    item.kind === "task" ? item.task.status : item.step.status,
  );
  const active = statuses.filter((status) =>
    ["canceling", "queued", "running"].includes(status),
  ).length;
  const failed = statuses.filter((status) =>
    ["blocked", "failed"].includes(status),
  ).length;

  async function run(item: OperationItem, action: string) {
    if (action === "regenerate") {
      setRegenerateItem(item);
      return;
    }
    if (action === "retry" || action === "retry-run") {
      const request = {
        item,
        scope:
          action === "retry-run"
            ? "run"
            : item.kind === "task"
              ? "request"
              : "step",
        preview: null,
        previewLoading: item.kind === "task",
        previewError: "",
      } as const;
      setRetryRequest(request);
      if (item.kind === "task") {
        void loadStudioMediaRetryPreview(item.id)
          .then(({ preview }) => {
            setRetryRequest((current) =>
              current?.item.id === item.id
                ? { ...current, preview, previewLoading: false }
                : current,
            );
          })
          .catch(() => {
            setRetryRequest((current) =>
              current?.item.id === item.id
                ? {
                    ...current,
                    previewLoading: false,
                    previewError: text.retryPreviewFailed,
                  }
                : current,
            );
          });
      }
      return;
    }
    setBusyId(item.id);
    try {
      if (action === "delete") {
        if (item.kind === "task") await deleteStudioMediaTask(item.id);
        else await deleteStudioWorkflow(item.workflow.id);
      } else if (item.kind === "task") {
        await controlStudioMediaTask(item.id, action as "cancel" | "retry");
      } else if (action === "retry") {
        await retryStudioWorkflowStep(
          item.workflow.id,
          item.step.key,
          "continue",
        );
      } else {
        await controlStudioWorkflow(
          item.workflow.id,
          action as "cancel" | "pause" | "resume",
        );
      }
      await onRefresh();
      if (action === "delete") {
        setDeleteItem(null);
        toast.success(text.deleteSuccess);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text.actionFailed);
    } finally {
      setBusyId("");
    }
  }

  const retrySteps =
    retryRequest?.item.kind === "workflow-step"
      ? retryRequest.scope === "run"
        ? workflowRetryStepKeys(
            retryRequest.item.workflow.steps.map((step) => ({
              stepKey: step.key,
              stepIndex: step.index,
              status: step.status,
              dependsOn: step.dependsOn ?? [],
            })),
          )
        : downstreamRetryStepKeys(
            retryRequest.item.workflow.steps.map((step) => ({
              stepKey: step.key,
              stepIndex: step.index,
              status: step.status,
              dependsOn: step.dependsOn ?? [],
            })),
            retryRequest.item.step.key,
          )
      : [];

  async function confirmRetry() {
    if (!retryRequest) return;
    const { item, scope } = retryRequest;
    if (
      item.kind === "task" &&
      (retryRequest.previewLoading ||
        !retryRequest.preview ||
        retryRequest.preview.blockers.length)
    )
      return;
    setBusyId(item.id);
    try {
      if (item.kind === "task") await controlStudioMediaTask(item.id, "retry");
      else if (scope === "run")
        await controlStudioWorkflow(item.workflow.id, "retry");
      else
        await retryStudioWorkflowStep(
          item.workflow.id,
          item.step.key,
          "continue",
        );
      setRetryRequest(null);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text.actionFailed);
    } finally {
      setBusyId("");
    }
  }

  async function previewBulkContinue() {
    const selected = selectedRetryableItems;
    if (!selected.length) return;
    const batchId = crypto.randomUUID();
    setBulkContinue({ batchId, items: selected, previews: {}, loading: true });
    const previews = await Promise.all(
      selected
        .filter((item) => item.kind === "task")
        .map(async (item) => {
          try {
            const result = await loadStudioMediaRetryPreview(item.id);
            return [item.id, result.preview] as const;
          } catch (error) {
            return [
              item.id,
              {
                taskId: item.id,
                targetType:
                  item.kind === "task"
                    ? (item.task.targetType ?? "media")
                    : "workflow",
                targetId:
                  item.kind === "task"
                    ? (item.task.targetId ?? item.id)
                    : item.id,
                retryCount: 0,
                requestCount: 0,
                reusesSavedOutput: false,
                estimatedCredits: null,
                availableCredits: null,
                projectBudget: null,
                batchBudget: null,
                blockers: [
                  {
                    code: "preview_failed",
                    message:
                      error instanceof Error
                        ? error.message
                        : text.retryPreviewFailed,
                  },
                ],
              },
            ] as const;
          }
        }),
    );
    setBulkContinue((current) =>
      current?.batchId === batchId
        ? { ...current, previews: Object.fromEntries(previews), loading: false }
        : current,
    );
  }

  async function confirmBulkContinue() {
    if (
      !bulkContinue ||
      bulkContinue.loading ||
      Object.values(bulkContinue.previews).some(
        (preview) => preview.blockers.length,
      )
    )
      return;
    const current = bulkContinue;
    setBusyId("bulk-continue");
    const failures: string[] = [];
    try {
      for (const item of current.items) {
        try {
          if (item.kind === "task")
            await controlStudioMediaTask(item.id, "retry");
          else
            await retryStudioWorkflowStep(
              item.workflow.id,
              item.step.key,
              "continue",
            );
        } catch (error) {
          failures.push(
            `${item.id}: ${error instanceof Error ? error.message : text.actionFailed}`,
          );
        }
      }
      setBulkContinue(null);
      setSelectedOperationIds((ids) =>
        ids.filter((id) => !current.items.some((item) => item.id === id)),
      );
      await onRefresh();
      if (failures.length)
        toast.warning(`${text.bulkRetryPartial}: ${failures.join(" · ")}`);
      else toast.success(text.bulkRetrySuccess);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text.actionFailed);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-2 border-b text-center">
        <Metric label={text.active} value={active} />
        <Metric label={text.failed} value={failed} />
      </div>
      <div
        className="grid shrink-0 gap-2 border-b p-2 sm:grid-cols-3"
        aria-label={text.filterLabel}
      >
        <NativeSelect
          aria-label={text.allCauses}
          className="h-8 min-w-0 text-xs"
          onChange={(event) =>
            setFailureFilters((current) => ({
              ...current,
              cause: event.target.value,
            }))
          }
          value={failureFilters.cause}
        >
          <NativeSelectOption value="all">{text.allCauses}</NativeSelectOption>
          {filterChoices.causes.map((cause) => (
            <NativeSelectOption key={cause} value={cause}>
              {operationCauseLabel(locale, cause)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={text.allModels}
          className="h-8 min-w-0 text-xs"
          onChange={(event) =>
            setFailureFilters((current) => ({
              ...current,
              model: event.target.value,
            }))
          }
          value={failureFilters.model}
        >
          <NativeSelectOption value="all">{text.allModels}</NativeSelectOption>
          {filterChoices.models.map((model) => (
            <NativeSelectOption key={model} value={model}>
              {model}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={text.allPhases}
          className="h-8 min-w-0 text-xs"
          onChange={(event) =>
            setFailureFilters((current) => ({
              ...current,
              phase: event.target.value,
            }))
          }
          value={failureFilters.phase}
        >
          <NativeSelectOption value="all">{text.allPhases}</NativeSelectOption>
          {filterChoices.phases.map((phase) => (
            <NativeSelectOption key={phase} value={phase}>
              {operationPhaseLabel(locale, phase)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <label className="flex min-h-9 items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            aria-label={text.selectRetryable}
            checked={allVisibleSelected}
            disabled={!retryableItems.length || Boolean(busyId)}
            onCheckedChange={(checked) =>
              setSelectedOperationIds((current) => {
                const visible = new Set(retryableItems.map((item) => item.id));
                const retained = current.filter((id) => !visible.has(id));
                return checked ? [...retained, ...visible] : retained;
              })
            }
          />
          {text.selectRetryable}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {text.selectedCount}: {selectedRetryableItems.length}
          </span>
          <Button
            disabled={!selectedRetryableItems.length || Boolean(busyId)}
            onClick={() => void previewBulkContinue()}
            size="sm"
            variant="outline"
          >
            <RotateCcw className="size-3.5" />
            {text.continueSelected}
          </Button>
          <Button
            disabled={!selectedRetryableItems.length || Boolean(busyId)}
            onClick={() =>
              setBulkRegenerationTargets(
                selectedRetryableItems.map((item) => ({
                  id: item.kind === "task" ? item.id : item.workflow.id,
                  kind: item.kind === "task" ? "media" : "workflow",
                  label:
                    item.kind === "task"
                      ? mediaTaskOperationLabel(locale, item.task)
                      : `${item.workflow.displayName ?? item.workflow.workflowType} · ${item.step.key}`,
                })),
              )
            }
            size="sm"
            variant="outline"
          >
            {text.regenerateSelected}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredItems.length ? (
          <div className="divide-y">
            {prioritizedItems.slice(0, 50).map((item, index) => (
              <div
                className={
                  index === 0 &&
                  (item.id === focusOperationId ||
                    (item.kind === "workflow-step" &&
                      item.workflow.id === focusOperationId))
                    ? "rounded-md ring-1 ring-primary/50"
                    : undefined
                }
                key={`${item.kind}:${item.id}`}
                ref={
                  index === 0 &&
                  (item.id === focusOperationId ||
                    (item.kind === "workflow-step" &&
                      item.workflow.id === focusOperationId))
                    ? focusedRow
                    : undefined
                }
              >
                <OperationRow
                  busy={busyId === item.id}
                  item={item}
                  locale={locale}
                  selected={selectedOperationIds.includes(item.id)}
                  selectable={
                    isOperationRetryable(item) &&
                    (item.kind === "task" || isWorkflowRunRetryActionItem(item))
                  }
                  onSelect={(checked) =>
                    setSelectedOperationIds((current) =>
                      checked
                        ? [...new Set([...current, item.id])]
                        : current.filter((id) => id !== item.id),
                    )
                  }
                  onAction={(action) => void run(item, action)}
                  onDelete={() => setDeleteItem(item)}
                  onTrace={() =>
                    onTrace(
                      item.kind === "task"
                        ? item.task.traceId
                        : item.workflow.traceId,
                    )
                  }
                  text={text}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <ListChecks className="size-5" />
            <p>{text.empty}</p>
          </div>
        )}
      </div>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && busyId !== "bulk-continue") setBulkContinue(null);
        }}
        open={Boolean(bulkContinue)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{text.bulkRetryTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {text.bulkRetryDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-72 min-w-0 space-y-2 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-xs">
            {bulkContinue?.loading ? (
              <p role="status">{text.retryPreviewLoading}</p>
            ) : null}
            {bulkContinue?.items.map((item) => {
              const preview = bulkContinue.previews[item.id];
              return (
                <div
                  className="min-w-0 space-y-1 border-b pb-2 last:border-b-0"
                  key={item.id}
                >
                  <p className="break-all font-medium">
                    {item.kind === "task"
                      ? `${item.task.targetType ?? "media"} · ${item.task.targetId ?? item.id} · ${item.task.model}`
                      : `${item.workflow.displayName ?? item.workflow.workflowType} · ${item.step.key}`}
                  </p>
                  {item.kind === "task" && preview ? (
                    <p>
                      {text.retryRequests}: {preview.requestCount} ·{" "}
                      {preview.estimatedCredits === null
                        ? text.retryCostUnknown
                        : `${preview.reservationOnly ? (locale === "en" ? "Reservation ceiling" : "预留上限（按产物时长结算）") : text.retryCost}: ${preview.estimatedCredits}`}
                    </p>
                  ) : null}
                  {item.kind === "workflow-step" ? (
                    <p className="text-muted-foreground">
                      {text.retryStepCount}:{" "}
                      {
                        downstreamRetryStepKeys(
                          item.workflow.steps.map((step) => ({
                            stepKey: step.key,
                            stepIndex: step.index,
                            status: step.status,
                            dependsOn: step.dependsOn ?? [],
                          })),
                          item.step.key,
                        ).length
                      }
                    </p>
                  ) : null}
                  {preview?.blockers.map((blocker) => (
                    <p
                      className="break-anywhere text-destructive"
                      key={blocker.code}
                    >
                      {blocker.message}
                    </p>
                  ))}
                </div>
              );
            })}
            {bulkContinue &&
            !bulkContinue.loading &&
            !Object.values(bulkContinue.previews).some(
              (preview) => preview.blockers.length,
            ) ? (
              <p className="text-muted-foreground">{text.bulkRetryReady}</p>
            ) : null}
            {bulkContinue &&
            !bulkContinue.loading &&
            Object.values(bulkContinue.previews).some(
              (preview) => preview.blockers.length,
            ) ? (
              <p role="alert" className="text-destructive">
                {text.bulkRetryBlocked}
              </p>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId === "bulk-continue"}>
              {text.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                !bulkContinue ||
                bulkContinue.loading ||
                Boolean(busyId) ||
                Object.values(bulkContinue.previews).some(
                  (preview) => preview.blockers.length,
                )
              }
              onClick={() => void confirmBulkContinue()}
            >
              <RotateCcw />
              {text.continueSelected}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !busyId) setDeleteItem(null);
        }}
        open={Boolean(deleteItem)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{text.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {text.deleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busyId)}>
              {text.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!deleteItem || Boolean(busyId)}
              onClick={() => {
                if (deleteItem) void run(deleteItem, "delete");
              }}
              variant="destructive"
            >
              <Trash2 />
              {text.confirmDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !busyId) setRetryRequest(null);
        }}
        open={Boolean(retryRequest)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{text.retryTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {retryRequest?.scope === "request"
                ? retryRequest.item.kind === "task" &&
                  retryRequest.preview?.reusesSavedOutput
                  ? text.retrySavedOutputScope
                  : text.retryRequestScope
                : retryRequest?.scope === "run"
                  ? text.retryRunScope
                  : text.retryStepScope}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {retryRequest ? (
            <div className="max-h-48 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm">
              {retryRequest.item.kind === "task" ? (
                <div className="space-y-2">
                  <p>
                    <span className="text-muted-foreground">
                      {text.retryTarget}:
                    </span>{" "}
                    {retryRequest.item.task.targetType ?? "media"} ·{" "}
                    {retryRequest.item.task.targetId ??
                      retryRequest.item.task.id}
                  </p>
                  {retryRequest.previewLoading ? (
                    <p role="status" className="text-xs text-muted-foreground">
                      {text.retryPreviewLoading}
                    </p>
                  ) : null}
                  {retryRequest.previewError ? (
                    <p role="alert" className="text-xs text-destructive">
                      {retryRequest.previewError}
                    </p>
                  ) : null}
                  {retryRequest.preview ? (
                    <div className="space-y-1 text-xs">
                      <p>
                        {text.retryRequests}:{" "}
                        {retryRequest.preview.requestCount}
                      </p>
                      {retryRequest.preview.requestCount ? (
                        retryRequest.preview.estimatedCredits === null ? (
                          <p>{text.retryCostUnknown}</p>
                        ) : (
                          <p>
                            {retryRequest.preview.reservationOnly ? (locale === "en" ? "Reservation ceiling; settled by output duration" : "预留上限（按产物时长结算，释放余量）") : text.retryCost}:{" "}
                            {retryRequest.preview.estimatedCredits} ·{" "}
                            {text.retryAvailable}:{" "}
                            {retryRequest.preview.availableCredits ?? "0"}
                          </p>
                        )
                      ) : null}
                      {retryRequest.preview.projectBudget?.configured ? (
                        <p>
                          {text.retryProjectRemaining}:{" "}
                          {retryRequest.preview.projectBudget.remaining ?? "0"}
                        </p>
                      ) : null}
                      {retryRequest.preview.batchBudget?.configured ? (
                        <p>
                          {text.retryBatchRemaining}:{" "}
                          {retryRequest.preview.batchBudget.remaining ?? "0"}
                        </p>
                      ) : null}
                      {retryRequest.preview.blockers.map((blocker) => (
                        <p
                          role="alert"
                          className="text-destructive"
                          key={blocker.code}
                        >
                          {blocker.message}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <p className="mb-1 text-muted-foreground">
                    {text.retryStepCount}: {retrySteps.length}
                  </p>
                  <ul className="list-inside list-disc space-y-0.5">
                    {retrySteps.map((key) => (
                      <li key={key}>{key}</li>
                    ))}
                  </ul>
                </>
              )}
              {retryRequest.item.kind !== "task" ||
              (retryRequest.preview?.requestCount ?? 0) > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {text.retryMayCost}
                </p>
              ) : null}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busyId)}>
              {text.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                !retryRequest ||
                Boolean(busyId) ||
                (retryRequest.item.kind === "task" &&
                  (retryRequest.previewLoading ||
                    !retryRequest.preview ||
                    retryRequest.preview.blockers.length > 0 ||
                    Boolean(retryRequest.previewError)))
              }
              onClick={() => void confirmRetry()}
            >
              <RotateCcw />
              {text.confirmRetry}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {regenerateItem ? (
        <RegenerationDialog
          key={regenerateItem.id}
          id={
            regenerateItem.kind === "task"
              ? regenerateItem.id
              : regenerateItem.workflow.id
          }
          kind={regenerateItem.kind === "task" ? "media" : "workflow"}
          locale={locale}
          onClose={() => setRegenerateItem(null)}
          onComplete={onRefresh}
        />
      ) : null}
      {bulkRegenerationTargets ? (
        <BulkRegenerationDialog
          key={bulkRegenerationTargets
            .map((item) => `${item.kind}:${item.id}`)
            .join("|")}
          locale={locale}
          onClose={() => setBulkRegenerationTargets(null)}
          onComplete={onRefresh}
          targets={bulkRegenerationTargets}
        />
      ) : null}
    </div>
  );
}

function operationCauseLabel(locale: StudioLocale, cause: string) {
  const labels: Record<string, readonly [string, string]> = {
    authentication: ["鉴权", "Authentication"],
    content_rejected: ["内容拒绝", "Content rejected"],
    dependency: ["前置依赖", "Dependency"],
    invalid_parameters: ["参数错误", "Invalid parameters"],
    network: ["网络", "Network"],
    other: ["其他错误", "Other"],
    output_validation: ["结果校验", "Output validation"],
    provider_unavailable: ["服务不可用", "Provider unavailable"],
    quota: ["额度", "Quota"],
    rate_limit: ["限流", "Rate limit"],
    result_storage: ["结果下载/保存", "Result storage"],
    timeout: ["超时", "Timeout"],
  };
  const pair = labels[cause];
  return pair ? pair[locale === "en" ? 1 : 0] : cause;
}

function operationPhaseLabel(locale: StudioLocale, phase: string) {
  const phases: Record<string, readonly [string, string]> = {
    blocked: ["阻塞", "Blocked"],
    canceled: ["已取消", "Canceled"],
    connecting: ["连接中", "Connecting"],
    failed: ["失败", "Failed"],
    generating: ["生成中", "Generating"],
    pending: ["待执行", "Pending"],
    queued: ["排队中", "Queued"],
    request_sent: ["已发送", "Request sent"],
    result_storage: ["结果保存", "Result storage"],
    running: ["运行中", "Running"],
    saving: ["保存中", "Saving"],
    succeeded: ["成功", "Succeeded"],
    submitted: ["已提交", "Submitted"],
    waiting_quota: ["等待额度", "Waiting for quota"],
  };
  const pair = phases[phase];
  return pair ? pair[locale === "en" ? 1 : 0] : phase;
}

function OperationRow({
  busy,
  item,
  locale,
  selected,
  selectable,
  onSelect,
  onAction,
  onDelete,
  onTrace,
  text,
}: {
  busy: boolean;
  item: OperationItem;
  locale: StudioLocale;
  selected: boolean;
  selectable: boolean;
  onSelect: (checked: boolean) => void;
  onAction: (action: string) => void;
  onDelete: () => void;
  onTrace: () => void;
  text: (typeof copy)[StudioLocale];
}) {
  const status = item.kind === "task" ? item.task.status : item.step.status;
  const label =
    item.kind === "task"
      ? mediaTaskOperationLabel(locale, item.task)
      : workflowStepOperationLabel(
          locale,
          item.workflow.workflowType,
          item.step,
          item.workflow.displayName,
        );
  const errorMessage = operationErrorMessage(
    item.kind === "task" ? item.task.error : item.step.error,
    locale,
  );
  const canDelete = isOperationDeletable(item);
  const canRetry = isOperationRetryable(item);
  return (
    <div className="px-3 py-3">
      <div className="flex items-start gap-2">
        {selectable ? (
          <Checkbox
            aria-label={
              locale === "en"
                ? `Select ${label} to continue`
                : `选择${label}以继续`
            }
            checked={selected}
            disabled={busy}
            onCheckedChange={(checked) => onSelect(checked === true)}
            className="mt-0.5"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 truncate text-xs font-medium">
              {label}
            </p>
            <StatusIndicator
              compact
              locale={locale}
              status={runtimeStatusToStageStatus(status)}
            />
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{formatStudioDate(locale, item.updatedAt)}</span>
            {item.kind === "task" ? <span>{item.task.progress}%</span> : null}
            {item.kind === "task" &&
            ["queued", "running"].includes(item.task.status) ? (
              <span
                className="min-w-0 truncate"
                title={mediaTaskExecutionPhaseLabel(
                  locale,
                  item.task.executionPhase,
                )}
              >
                {mediaTaskExecutionPhaseLabel(locale, item.task.executionPhase)}
              </span>
            ) : null}
            {item.kind === "workflow-step" ? (
              <span>{workflowAttemptLabel(item.step, locale)}</span>
            ) : null}
            {item.kind === "workflow-step" && item.workflow.workflowVersion ? (
              <span>
                {text.workflowVersion} v{item.workflow.workflowVersion}
              </span>
            ) : null}
          </div>
          {errorMessage ? (
            <p
              className="mt-1 line-clamp-2 text-[10px] leading-4 text-destructive"
              title={errorMessage}
            >
              {errorMessage}
            </p>
          ) : null}
          {item.kind === "task" &&
          item.task.output?.some(
            (asset) => asset.metadata?.productionConfigurationStale,
          ) ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {locale === "en"
                ? "Output uses older settings"
                : "产物使用旧配置，需要复核"}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
        {(
          item.kind === "task"
            ? ["succeeded", "failed", "canceled"].includes(status)
            : ["succeeded", "failed", "blocked", "canceled"].includes(
                item.workflow.status,
              )
        ) ? (
          <Action
            disabled={busy}
            icon={CirclePlay}
            label={text.regenerate}
            onClick={() => onAction("regenerate")}
          />
        ) : null}
        {item.kind === "task" && ["queued", "running"].includes(status) ? (
          <Action
            disabled={busy}
            icon={Ban}
            label={text.cancel}
            onClick={() => onAction("cancel")}
          />
        ) : null}
        {item.kind === "task" && canRetry ? (
          <Action
            disabled={busy}
            icon={RotateCcw}
            label={text.retryTask}
            onClick={() => onAction("retry")}
          />
        ) : null}
        {item.kind === "workflow-step" &&
        status === "running" &&
        item.workflow.status === "running" ? (
          <Action
            disabled={busy}
            icon={CirclePause}
            label={text.pause}
            onClick={() => onAction("pause")}
          />
        ) : null}
        {item.kind === "workflow-step" && item.workflow.status === "paused" ? (
          <Action
            disabled={busy}
            icon={CirclePlay}
            label={text.resume}
            onClick={() => onAction("resume")}
          />
        ) : null}
        {item.kind === "workflow-step" &&
        ["queued", "running", "paused", "canceling"].includes(
          item.workflow.status,
        ) &&
        ["pending", "queued", "running"].includes(status) ? (
          <Action
            disabled={busy}
            icon={Ban}
            label={text.cancel}
            onClick={() => onAction("cancel")}
          />
        ) : null}
        {item.kind === "workflow-step" && canRetry ? (
          <Action
            disabled={busy}
            icon={RotateCcw}
            label={text.retryWorkflow}
            onClick={() => onAction("retry")}
          />
        ) : null}
        {isWorkflowRunRetryActionItem(item) ? (
          <Action
            disabled={busy}
            icon={ListRestart}
            label={text.retryRun}
            onClick={() => onAction("retry-run")}
          />
        ) : null}
        <Action
          disabled={busy}
          icon={ScanSearch}
          label={text.inspect}
          onClick={onTrace}
        />
        {canDelete ? (
          <Action
            danger
            disabled={busy}
            icon={Trash2}
            label={text.delete}
            onClick={onDelete}
          />
        ) : null}
      </div>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r px-3 py-3 last:border-r-0">
      <p className="font-mono text-base font-semibold">{value}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Action({
  danger,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  danger?: boolean;
  disabled?: boolean;
  icon: typeof Ban;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className={
              danger ? "text-destructive hover:text-destructive" : undefined
            }
            disabled={disabled}
            onClick={onClick}
            size="icon-sm"
            type="button"
            variant="ghost"
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
