import { describe, expect, it } from "vitest";

import type { StudioExecutionSpan, StudioUsageCost, WorkspaceSnapshot } from "../types";
import {
  buildOperationItems,
  buildTraceRows,
  summarizeUsageCosts,
} from "./inspector-view-model";

describe("studio inspector view model", () => {
  it("sorts project operations and filters the selected episode", () => {
    const snapshot = {
      project: { episodes: [] },
      workflows: [
        { id: "run-1", episodeId: "episode-1", updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      tasks: [
        { id: "task-1", episodeId: "episode-1", updatedAt: "2026-01-02T00:00:00.000Z" },
        { id: "task-2", episodeId: "episode-2", updatedAt: "2026-01-03T00:00:00.000Z" },
      ],
    } as unknown as WorkspaceSnapshot;

    expect(buildOperationItems(snapshot, "episode-1").map((item) => item.id)).toEqual([
      "task-1",
      "run-1",
    ]);
  });

  it("totals persisted usage costs", () => {
    const costs = [
      { cost: "0.125", quantity: 2 },
      { cost: "0.375", quantity: 3 },
    ] as StudioUsageCost[];
    expect(summarizeUsageCosts(costs)).toEqual({ quantity: 5, total: 0.5 });
  });

  it("builds trace rows from parent span relationships", () => {
    const spans = [
      { spanId: "root" },
      { spanId: "task", parentSpanId: "step" },
      { spanId: "step", parentSpanId: "root" },
    ] as StudioExecutionSpan[];
    expect(
      buildTraceRows(spans).map(({ depth, span }) => [span.spanId, depth]),
    ).toEqual([
      ["root", 0],
      ["step", 1],
      ["task", 2],
    ]);
  });
});
