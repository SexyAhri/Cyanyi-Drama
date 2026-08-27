import { describe, expect, it } from "vitest";

import type { MediaTask } from "@/lib/media/task-contract";
import { emptyVfxQc, type VfxShotPackage } from "@/lib/production/vfx-contract";

import type { ProductionDeliverableRecord } from "../types";
import {
  getCurrentVfxShotVersion,
  getLatestVfxTask,
  getVfxPipelineState,
  getVfxQcReadiness,
  getVfxShotVersions,
} from "./vfx-view-model";

describe("VFX shot view model", () => {
  it("keeps shot versions isolated and selects the active version", () => {
    const versions = getVfxShotVersions(
      [deliverable(1, "superseded"), deliverable(2, "draft"), deliverable(3, "draft", "panel-2")],
      "panel-1",
    );
    expect(versions.map((item) => item.deliverable.version)).toEqual([2, 1]);
    expect(getCurrentVfxShotVersion(versions)?.deliverable.version).toBe(2);
  });

  it("scopes tasks by shot, stage, and deliverable version", () => {
    const tasks = [
      task("old", "vfx_element", "package-1", "2026-08-27T01:00:00Z"),
      task("new", "vfx_element", "package-2", "2026-08-27T02:00:00Z"),
      task("comp", "vfx_composite", "package-2", "2026-08-27T03:00:00Z"),
    ];
    expect(getLatestVfxTask(tasks, "panel-1", "element", "package-2")?.id).toBe("new");
    expect(getLatestVfxTask(tasks, "panel-1", "composite", "package-2")?.id).toBe("comp");
  });

  it("blocks downstream stages until plate and elements are ready", () => {
    const shotPackage = packagePayload();
    expect(getVfxPipelineState(shotPackage, [], "panel-1")).toMatchObject({
      plate: "waiting",
      element: "blocked",
      composite: "blocked",
      qc: "blocked",
    });
    shotPackage.plate.assetIds.push("plate-1");
    shotPackage.elements.assetIds.push("element-1");
    expect(getVfxPipelineState(shotPackage, [], "panel-1")).toMatchObject({
      plate: "succeeded",
      element: "ready",
      composite: "ready",
    });
  });

  it("requires every machine-readable QC check to pass", () => {
    const shotPackage = packagePayload();
    expect(getVfxQcReadiness(shotPackage)).toMatchObject({ complete: 0, total: 6 });
    for (const check of Object.values(shotPackage.qc)) check.status = "pass";
    expect(getVfxQcReadiness(shotPackage).isReady).toBe(true);
  });
});

function packagePayload(): VfxShotPackage {
  return {
    schemaVersion: 1,
    panelId: "panel-1",
    category: "cleanup",
    complexity: "medium",
    summary: "Remove practical rig",
    colorSpace: "ACEScg",
    plate: { requirements: ["clean plate"], assetIds: [] },
    elements: { requirements: ["dust"], assetIds: [] },
    trackingRequirements: ["camera solve"],
    matteRequirements: ["subject roto"],
    compositeNotes: ["preserve grain"],
    qc: emptyVfxQc(),
  };
}

function deliverable(
  version: number,
  status: string,
  panelId = "panel-1",
): ProductionDeliverableRecord {
  return {
    id: `package-${version}`,
    projectId: "project-1",
    episodeId: "episode-1",
    scopeType: "storyboard_panel",
    scopeId: panelId,
    department: "vfx",
    deliverableType: "vfx_shot_package",
    title: `VFX ${version}`,
    status,
    version,
    payload: packagePayload(),
    sourceRefs: [],
    cost: "0",
    dependencyHash: "hash",
    approvalGates: [],
    dependencies: [],
    createdAt: "2026-08-27T00:00:00Z",
    updatedAt: "2026-08-27T00:00:00Z",
  };
}

function task(
  id: string,
  targetType: string,
  deliverableId: string,
  updatedAt: string,
): MediaTask {
  return {
    id,
    traceId: `${id}-trace`,
    spanId: `${id}-span`,
    projectId: "project-1",
    episodeId: "episode-1",
    targetType,
    targetId: "panel-1",
    kind: "video",
    status: "succeeded",
    provider: "test",
    protocol: "openai-compatible",
    model: "test",
    request: { deliverableId },
    retryCount: 0,
    maxRetries: 2,
    progress: 100,
    createdAt: updatedAt,
    updatedAt,
  };
}
