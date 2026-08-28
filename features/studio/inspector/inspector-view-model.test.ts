import { describe, expect, it } from "vitest";

import type { StudioExecutionSpan, StudioUsageCost, WorkspaceSnapshot } from "../types";
import {
  buildOperationItems,
  buildTraceRows,
  isOperationRetryable,
  type OperationItem,
  summarizeUsageCosts,
} from "./inspector-view-model";

describe("studio inspector view model", () => {
  it("sorts project operations and filters the selected episode", () => {
    const snapshot = {
      project: { episodes: [] },
      workflows: [
        {
          id: "run-1",
          episodeId: "episode-1",
          updatedAt: "2026-01-01T00:00:00.000Z",
          steps: [
            {
              id: "step-parse",
              completedAt: "2026-01-01T00:01:00.000Z",
              key: "parse",
              type: "parse_novel",
            },
            {
              id: "step-split",
              completedAt: "2026-01-01T00:02:00.000Z",
              key: "split",
              type: "split_clips",
            },
            {
              id: "step-screenplay",
              completedAt: "2026-01-01T00:03:00.000Z",
              key: "screenplay",
              type: "convert_screenplay",
            },
          ],
        },
      ],
      tasks: [
        { id: "task-1", episodeId: "episode-1", updatedAt: "2026-01-02T00:00:00.000Z" },
        { id: "task-2", episodeId: "episode-2", updatedAt: "2026-01-03T00:00:00.000Z" },
      ],
    } as unknown as WorkspaceSnapshot;

    expect(buildOperationItems(snapshot, "episode-1").map((item) => item.id)).toEqual([
      "task-1",
      "step-screenplay",
      "step-split",
      "step-parse",
    ]);
  });

  it("merges granular workflow steps with media tasks", () => {
    const snapshot = {
      project: { episodes: [] },
      workflows: [
        {
          id: "run-1",
          episodeId: "episode-1",
          updatedAt: "2026-01-01T00:00:00.000Z",
          steps: [
            {
              id: "step-1",
              key: "parse",
              type: "parse_novel",
              startedAt: "2026-01-03T00:00:00.000Z",
            },
          ],
        },
      ],
      tasks: [
        {
          id: "task-1",
          episodeId: "episode-1",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    } as unknown as WorkspaceSnapshot;

    expect(buildOperationItems(snapshot, "episode-1")).toMatchObject([
      { id: "step-1", kind: "workflow-step" },
      { id: "task-1", kind: "task" },
    ]);
  });

  it("totals persisted usage costs", () => {
    const costs = [
      { cost: "0.125", quantity: 2 },
      { cost: "0.375", quantity: 3 },
    ] as StudioUsageCost[];
    expect(summarizeUsageCosts(costs)).toEqual({ quantity: 5, total: 0.5 });
  });

  it("only retries failed operations that still have attempts", () => {
    const task = {
      id: "task-1",
      kind: "task",
      updatedAt: "2026-01-01T00:00:00.000Z",
      task: {
        status: "failed",
        retryCount: 0,
        maxRetries: 2,
        error: { message: "provider rejected request", retryable: false },
      },
    } as OperationItem;
    expect(isOperationRetryable(task)).toBe(true);
    expect(
      isOperationRetryable({
        id: "task-1",
        kind: "task",
        updatedAt: "2026-01-01T00:00:00.000Z",
        task: {
          status: "failed",
          retryCount: 2,
          maxRetries: 2,
          error: { message: "timeout", retryable: true },
        },
      } as OperationItem),
    ).toBe(false);

    const step = {
      id: "step-1",
      kind: "workflow-step",
      updatedAt: "2026-01-01T00:00:00.000Z",
      workflow: {},
      step: {
        status: "failed",
        retryable: true,
        attempt: 1,
        maxAttempts: 3,
      },
    } as OperationItem;
    expect(isOperationRetryable(step)).toBe(true);
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
