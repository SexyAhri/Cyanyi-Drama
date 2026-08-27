import { describe, expect, it } from "vitest";

import type {
  ProductionDeliverableCatalog,
  ProductionDeliverableRecord,
  WorkspaceSnapshot,
} from "../types";
import {
  buildDefaultProductionControl,
  buildProductionAcceptance,
  getBatchApprovalCandidates,
  getCurrentDeliverables,
  summarizeDepartments,
} from "./production-control-view-model";

describe("production control view model", () => {
  it("keeps only the latest deliverable in each scope and type", () => {
    const current = getCurrentDeliverables([
      deliverable({ id: "v1", version: 1, status: "superseded" }),
      deliverable({ id: "v2", version: 2, status: "review" }),
      deliverable({ id: "other", deliverableType: "color_master" }),
    ]);
    expect(current.map((item) => item.id)).toEqual(["v2", "other"]);
  });

  it("summarizes blocked departments and batch approval candidates", () => {
    const review = deliverable({
      status: "review",
      approvalGates: [{ key: "creative", status: "pending" }],
    });
    const catalog = catalogWith([
      review,
      deliverable({
        id: "post-master",
        department: "post",
        deliverableType: "color_master",
        status: "stale",
      }),
    ]);
    expect(getBatchApprovalCandidates(catalog.deliverables)).toHaveLength(1);
    expect(summarizeDepartments(catalog).find((item) => item.id === "post")?.blocked).toBe(1);
  });

  it("fails acceptance for runtime errors and budget overrun", () => {
    const control = buildDefaultProductionControl("project-1");
    control.budget.limit = 5;
    const report = buildProductionAcceptance({
      catalog: catalogWith([]),
      control,
      costs: [{ cost: "6" } as never],
      generatedAt: "2026-08-27T00:00:00.000Z",
      stages: [],
      snapshot: {
        project: { id: "project-1", episodes: [] },
        tasks: [{ id: "task-1", status: "failed" }],
        workflows: [],
      } as unknown as WorkspaceSnapshot,
    });
    expect(report.overallStatus).toBe("fail");
    expect(report.checks.find((item) => item.id === "runtime")?.status).toBe("fail");
    expect(report.checks.find((item) => item.id === "budget")?.status).toBe("fail");
    expect(report.audit.taskIds).toEqual(["task-1"]);
  });
});

function catalogWith(deliverables: ProductionDeliverableRecord[]): ProductionDeliverableCatalog {
  return {
    departments: [
      { id: "art", agents: [], deliverableTypes: [], requiredGates: [] },
      { id: "post", agents: [], deliverableTypes: [], requiredGates: [] },
    ],
    deliverables,
  };
}

function deliverable(
  overrides: Partial<ProductionDeliverableRecord> = {},
): ProductionDeliverableRecord {
  return {
    id: "deliverable-1",
    projectId: "project-1",
    scopeType: "episode",
    scopeId: "episode-1",
    department: "art",
    deliverableType: "visual_bible",
    title: "Visual bible",
    status: "locked",
    version: 1,
    payload: {},
    sourceRefs: [],
    cost: "0",
    dependencyHash: "hash",
    approvalGates: [],
    dependencies: [],
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}
