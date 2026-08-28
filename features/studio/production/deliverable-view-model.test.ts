import { describe, expect, it } from "vitest";

import type { ProductionDeliverableRecord } from "../types";
import {
  filterProductionDeliverables,
  getDeliverableGuidance,
  getDeliverableBlockers,
  getNextPendingGate,
  payloadLines,
  suggestedDependencyIds,
} from "./deliverable-view-model";

describe("production deliverable view model", () => {
  it("separates art deliverables from script and VFX ownership", () => {
    const values = [
      deliverable({ department: "art", deliverableType: "visual_bible" }),
      deliverable({ department: "script", deliverableType: "script_breakdown" }),
      deliverable({ department: "vfx", deliverableType: "vfx_breakdown" }),
    ];
    expect(filterProductionDeliverables(values, ["art"]).map((item) => item.deliverableType)).toEqual([
      "visual_bible",
    ]);
  });

  it("reports stale and unapproved upstream dependencies", () => {
    const value = deliverable({
      dependencies: [
        dependency("approved", 2, 2),
        dependency("draft", 1, 1),
        dependency("locked", 1, 2),
      ],
    });
    expect(getDeliverableBlockers(value)).toHaveLength(2);
  });

  it("finds the next gate and normalizes line-oriented payloads", () => {
    const value = deliverable({
      approvalGates: [
        { key: "creative", status: "approved" },
        { key: "art", status: "pending" },
      ],
    });
    expect(getNextPendingGate(value)?.key).toBe("art");
    expect(payloadLines("one\n\ntwo")).toEqual(["one", "two"]);
  });

  it("explains downstream use and recommends only approved current upstream types", () => {
    expect(getDeliverableGuidance("zh-CN", "story_bible")).toMatchObject({
      mode: "automatic",
      usedBy: expect.stringContaining("剧本"),
    });
    const ids = suggestedDependencyIds("blocking", [
      deliverable({
        id: "screenplay-v1",
        deliverableType: "screenplay_lock",
        status: "approved",
        version: 1,
      }),
      deliverable({
        id: "screenplay-v2",
        deliverableType: "screenplay_lock",
        status: "locked",
        version: 2,
      }),
      deliverable({
        id: "continuity-draft",
        deliverableType: "continuity_bible",
        status: "draft",
      }),
    ]);
    expect(ids).toEqual(["screenplay-v2"]);
  });
});

function dependency(status: string, requiredVersion: number, currentVersion: number) {
  return {
    id: `${status}-${requiredVersion}`,
    title: status,
    status,
    requiredVersion,
    currentVersion,
  };
}

function deliverable(
  overrides: Partial<ProductionDeliverableRecord> = {},
): ProductionDeliverableRecord {
  return {
    id: "deliverable-1",
    projectId: "project-1",
    scopeType: "project",
    scopeId: "project-1",
    department: "art",
    deliverableType: "visual_bible",
    title: "Visual bible",
    status: "draft",
    version: 1,
    payload: {},
    sourceRefs: [],
    cost: "0.000000",
    dependencyHash: "hash",
    approvalGates: [],
    dependencies: [],
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}
