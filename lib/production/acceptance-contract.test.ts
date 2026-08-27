import { describe, expect, it } from "vitest";

import {
  parseProductionAcceptance,
  parseProductionControl,
} from "./acceptance-contract";

describe("production acceptance contracts", () => {
  it("accepts a versioned budget and schedule", () => {
    expect(
      parseProductionControl({
        schemaVersion: 1,
        projectId: "project-1",
        budget: { currency: "CNY", limit: 10_000, contingencyPercent: 10 },
        milestones: [
          {
            id: "lock",
            name: "Picture lock",
            department: "post",
            dueDate: "2026-09-01",
            status: "in_progress",
            note: "",
          },
        ],
        notes: "",
      }).success,
    ).toBe(true);
  });

  it("rejects acceptance reports without auditable evidence", () => {
    const result = parseProductionAcceptance({
      schemaVersion: 1,
      projectId: "project-1",
      episodeId: null,
      generatedAt: "2026-08-27T00:00:00.000Z",
      overallStatus: "pass",
      stages: [],
      departments: [],
      finance: {
        currency: "CNY",
        budget: 100,
        actual: 10,
        contingency: 10,
        forecast: 20,
        variance: 80,
      },
      checks: [{ id: "budget", category: "budget", status: "pass" }],
      blockers: [],
      audit: { deliverableIds: [], workflowIds: [], taskIds: [] },
    });
    expect(result.success).toBe(false);
  });
});
