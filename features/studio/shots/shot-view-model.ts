import type { MediaTask } from "@/lib/media/task-contract";

import type {
  ProjectMediaAsset,
  StudioStoryboardPanel,
} from "../types";

export type ShotMediaKind = "image" | "video";

export type ShotMediaCandidate = {
  assetId: string | null;
  createdAt: string;
  id: string;
  kind: ShotMediaKind;
  selected: boolean;
  status: MediaTask["status"];
  task?: MediaTask;
  url: string | null;
  segmentIndex?: number;
  segmentCount?: number;
  configurationStale?: boolean;
};

export type ShotCandidateSnapshot = {
  taskId: string;
  provider: string;
  model: string;
  prompt?: string;
  inputHash?: string;
  requestHash?: string;
  configurationHash?: string;
  configurationSources: Array<{ scopeKey: string; version: number }>;
  parameters: Record<string, string | number | boolean>;
};

export function shotCandidateSnapshot(candidate: ShotMediaCandidate): ShotCandidateSnapshot | undefined {
  const task = candidate.task;
  if (!task) return undefined;
  const request = task.request;
  const configuration = asRecord(request.productionConfiguration);
  const sources = Array.isArray(configuration?.sources)
    ? configuration.sources.flatMap((source) => {
        const record = asRecord(source);
        return typeof record?.scopeKey === "string" && typeof record.version === "number"
          ? [{ scopeKey: record.scopeKey, version: record.version }]
          : [];
      })
    : [];
  const parameterKeys = ["ratio", "resolution", "duration", "videoMode", "audioMode", "format", "quality", "qualityTier", "seed", "fps"];
  const parameters = Object.fromEntries(parameterKeys.flatMap((key) => {
    const value = request[key];
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? [[key, value]]
      : [];
  }));
  return {
    taskId: task.id,
    provider: task.provider,
    model: task.model,
    ...(typeof request.prompt === "string" ? { prompt: request.prompt } : {}),
    ...(typeof request.inputHash === "string" ? { inputHash: request.inputHash } : {}),
    ...(typeof request.requestHash === "string" ? { requestHash: request.requestHash } : {}),
    ...(typeof request.configurationHash === "string" ? { configurationHash: request.configurationHash } : {}),
    configurationSources: sources,
    parameters,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export type ShotBatchProgress = {
  batchId: string;
  kind: ShotMediaKind;
  succeeded: number;
  failed: number;
  pending: number;
  canceled: number;
  total: number;
};

export function latestShotBatchProgress(
  tasks: MediaTask[],
  episodeId: string,
  kind: ShotMediaKind,
): ShotBatchProgress | undefined {
  const matching = tasks.filter(
    (task) =>
      task.episodeId === episodeId &&
      task.kind === kind &&
      task.targetType === "storyboard_panel" &&
      typeof task.batchId === "string" &&
      task.batchId.startsWith("storyboard_"),
  );
  const latest = [...matching].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  )[0];
  if (!latest?.batchId) return undefined;

  const batch = matching.filter((task) => task.batchId === latest.batchId);
  return {
    batchId: latest.batchId,
    kind,
    succeeded: batch.filter((task) => task.status === "succeeded").length,
    failed: batch.filter(
      (task) =>
        task.status === "failed" &&
        !(task.error?.retryable && task.progressMessage === "Retrying task"),
    ).length,
    pending: batch.filter(
      (task) =>
        ["queued", "running"].includes(task.status) ||
        (task.status === "failed" &&
          Boolean(task.error?.retryable) &&
          task.progressMessage === "Retrying task"),
    ).length,
    canceled: batch.filter((task) => task.status === "canceled").length,
    total: batch.length,
  };
}

export function buildShotMediaCandidates(
  panel: StudioStoryboardPanel,
  kind: ShotMediaKind,
  assets: ProjectMediaAsset[],
  tasks: MediaTask[],
) {
  const panelTasks = tasks
    .filter(
      (task) =>
        task.targetType === "storyboard_panel" &&
        task.targetId === panel.id &&
        task.kind === kind,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const candidates = new Map<string, ShotMediaCandidate>();
  const videoSegments = kind === "video" ? panel.videoSegments : [];
  const selectedAssetId =
    kind === "image" ? panel.imageAssetId : panel.videoAssetId;

  for (const asset of assets) {
    if (
      asset.kind !== kind ||
      asset.sourceTargetType !== "storyboard_panel" ||
      asset.sourceTargetId !== panel.id
    ) {
      continue;
    }
    const task = panelTasks.find((item) =>
      item.output?.some((output) => output.id === asset.id),
    );
    const segment = videoSegments.find(
      (item) => item.videoAssetId === asset.id || item.taskId === task?.id,
    );
    candidates.set(asset.id, {
      assetId: asset.id,
      createdAt: asset.createdAt,
      id: asset.id,
      kind,
      selected: segment ? segment.videoAssetId === asset.id : asset.id === selectedAssetId,
      status: task?.status ?? "succeeded",
      task,
      url: asset.url,
      configurationStale: Boolean(asset.metadata.productionConfigurationStale),
      ...(segment
        ? {
            segmentIndex: segment.segmentIndex,
            segmentCount: videoSegments.length,
          }
        : {}),
    });
  }

  for (const task of panelTasks) {
    for (const output of task.output ?? []) {
      if (output.kind !== kind || candidates.has(output.id)) continue;
      const segment = videoSegments.find(
        (item) => item.videoAssetId === output.id || item.taskId === task.id,
      );
      candidates.set(output.id, {
        assetId: output.id,
        createdAt: task.updatedAt,
        id: output.id,
        kind,
        selected: segment
          ? segment.videoAssetId === output.id
          : output.id === selectedAssetId,
        status: task.status,
        task,
        url: output.url || null,
        configurationStale: Boolean(output.metadata?.productionConfigurationStale),
        ...(segment
          ? {
              segmentIndex: segment.segmentIndex,
              segmentCount: videoSegments.length,
            }
          : {}),
      });
    }
  }

  if (selectedAssetId && !candidates.has(selectedAssetId)) {
    candidates.set(selectedAssetId, {
      assetId: selectedAssetId,
      createdAt: panel.updatedAt,
      id: selectedAssetId,
      kind,
      selected: true,
      status: "succeeded",
      url: null,
    });
  }

  const pending = panelTasks
    .filter(
      (task) =>
        ["queued", "running", "failed"].includes(task.status) &&
        !task.output?.length &&
        ![...candidates.values()].some(
          (candidate) => candidate.task?.id === task.id,
        ),
    )
    .map((task) => ({
      assetId: null,
      createdAt: task.updatedAt,
      id: task.id,
      kind,
      selected: false,
      status: task.status,
      task,
      url: null,
      ...(() => {
        const segment = videoSegments.find((item) => item.taskId === task.id);
        return segment
          ? {
              segmentIndex: segment.segmentIndex,
              segmentCount: videoSegments.length,
            }
          : {};
      })(),
    }) satisfies ShotMediaCandidate);

  return [...candidates.values(), ...pending].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export function latestPanelTasks(
  panelIds: string[],
  kind: ShotMediaKind,
  tasks: MediaTask[],
) {
  const ids = new Set(panelIds);
  const latest = new Map<string, MediaTask>();
  for (const task of tasks
    .filter(
      (item) =>
        item.targetType === "storyboard_panel" &&
        item.targetId &&
        ids.has(item.targetId) &&
        item.kind === kind,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))) {
    if (task.targetId && !latest.has(task.targetId)) {
      latest.set(task.targetId, task);
    }
  }
  return [...latest.values()];
}

export function nextStoryboardPanel(
  panel: StudioStoryboardPanel,
  panels: StudioStoryboardPanel[],
) {
  if (!panel.linkedToNextPanel) return undefined;
  return panels
    .filter((item) => item.panelIndex > panel.panelIndex)
    .sort((left, right) => left.panelIndex - right.panelIndex)[0];
}
