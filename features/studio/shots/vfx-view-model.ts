import type { MediaTask } from "@/lib/media/task-contract";
import {
  parseVfxShotPackage,
  VFX_QC_KEYS,
  type VfxShotPackage,
  type VfxTaskStage,
} from "@/lib/production/vfx-contract";

import type { ProductionDeliverableRecord } from "../types";

export type VfxShotVersion = {
  deliverable: ProductionDeliverableRecord;
  package: VfxShotPackage | null;
};

export function getVfxShotVersions(
  deliverables: ProductionDeliverableRecord[],
  panelId: string,
) {
  return deliverables
    .filter(
      (item) =>
        item.department === "vfx" &&
        item.deliverableType === "vfx_shot_package" &&
        item.scopeType === "storyboard_panel" &&
        item.scopeId === panelId,
    )
    .sort((left, right) => right.version - left.version)
    .map((deliverable) => {
      const parsed = parseVfxShotPackage(deliverable.payload);
      return {
        deliverable,
        package: parsed.success ? parsed.data : null,
      } satisfies VfxShotVersion;
    });
}

export function getCurrentVfxShotVersion(versions: VfxShotVersion[]) {
  return versions.find(
    (item) => !["stale", "superseded"].includes(item.deliverable.status),
  );
}

export function getVfxQcReadiness(shotPackage: VfxShotPackage | null) {
  const checks = VFX_QC_KEYS.map(
    (key) => shotPackage?.qc[key]?.status ?? "pending",
  );
  const complete = checks.filter((status) => status === "pass").length;
  const failed = checks.filter((status) => status === "fail").length;
  return {
    complete,
    failed,
    isReady: complete === VFX_QC_KEYS.length,
    total: VFX_QC_KEYS.length,
  };
}

export function getLatestVfxTask(
  tasks: MediaTask[],
  panelId: string,
  stage: VfxTaskStage,
  deliverableId?: string,
): MediaTask | undefined {
  const targetType = stage === "element" ? "vfx_element" : "vfx_composite";
  return tasks
    .filter(
      (task) =>
        task.targetType === targetType &&
        task.targetId === panelId &&
        (!deliverableId || task.request.deliverableId === deliverableId),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function getVfxPipelineState(
  shotPackage: VfxShotPackage | null,
  tasks: MediaTask[],
  panelId: string,
  deliverableId?: string,
) {
  const elementTask = getLatestVfxTask(
    tasks,
    panelId,
    "element",
    deliverableId,
  );
  const compositeTask = getLatestVfxTask(
    tasks,
    panelId,
    "composite",
    deliverableId,
  );
  const plateReady = Boolean(shotPackage?.plate.assetIds.length);
  const elementSelected = Boolean(shotPackage?.elements.assetIds.length);
  const compositeReady = compositeTask?.status === "succeeded";
  return {
    composite:
      compositeTask?.status ??
      (plateReady && elementSelected ? "ready" : "blocked"),
    element: elementTask?.status ?? (plateReady ? "ready" : "blocked"),
    plate: plateReady ? "succeeded" : "waiting",
    qc: compositeReady
      ? getVfxQcReadiness(shotPackage).isReady
        ? "succeeded"
        : "ready"
      : "blocked",
  } as const;
}
