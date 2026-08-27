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
};

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
    candidates.set(asset.id, {
      assetId: asset.id,
      createdAt: asset.createdAt,
      id: asset.id,
      kind,
      selected: asset.id === selectedAssetId,
      status: task?.status ?? "succeeded",
      task,
      url: asset.url,
    });
  }

  for (const task of panelTasks) {
    for (const output of task.output ?? []) {
      if (output.kind !== kind || candidates.has(output.id)) continue;
      candidates.set(output.id, {
        assetId: output.id,
        createdAt: task.updatedAt,
        id: output.id,
        kind,
        selected: output.id === selectedAssetId,
        status: task.status,
        task,
        url: output.url || null,
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
