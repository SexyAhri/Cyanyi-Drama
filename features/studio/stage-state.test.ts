import { describe, expect, it } from "vitest";

import type { MediaTask } from "@/lib/media/task-contract";

import { getStudioStageStates, getTasksForStage } from "./stage-state";
import type { WorkspaceSnapshot } from "./types";

describe("studio stage state", () => {
  it("blocks downstream stages until an episode has input", () => {
    const stages = getStudioStageStates(snapshot(), "episode-1");
    expect(stages.map((stage) => stage.status)).toEqual([
      "not_started",
      "blocked",
      "blocked",
      "blocked",
      "blocked",
      "blocked",
    ]);
  });

  it("uses persisted workflow state for writing and storyboard", () => {
    const stages = getStudioStageStates(
      snapshot({
        novelText: "第一章",
        workflows: [
          workflow("story-to-script", "succeeded", "2026-08-26T01:00:00Z"),
          workflow("script-to-storyboard", "running", "2026-08-26T02:00:00Z"),
        ],
      }),
      "episode-1",
    );
    expect(stages[0].status).toBe("completed");
    expect(stages[1].status).toBe("ready");
    expect(stages[2].status).toBe("running");
  });

  it("surfaces failed media tasks instead of inferring progress", () => {
    const stages = getStudioStageStates(
      snapshot({
        novelText: "第一章",
        workflows: [
          workflow("story-to-script", "succeeded", "2026-08-26T01:00:00Z"),
          workflow(
            "script-to-storyboard",
            "succeeded",
            "2026-08-26T02:00:00Z",
          ),
        ],
        tasks: [mediaTask("failed")],
      }),
      "episode-1",
    );
    expect(stages[3]).toMatchObject({
      status: "failed",
      failedTasks: 1,
      totalTasks: 1,
    });
  });

  it("marks a media stage complete only from succeeded tasks", () => {
    const stages = getStudioStageStates(
      snapshot({
        novelText: "第一章",
        workflows: [
          workflow("story-to-script", "succeeded", "2026-08-26T01:00:00Z"),
          workflow(
            "script-to-storyboard",
            "succeeded",
            "2026-08-26T02:00:00Z",
          ),
        ],
        tasks: [mediaTask("succeeded")],
      }),
      "episode-1",
    );
    expect(stages[3]).toMatchObject({
      status: "completed",
      completedTasks: 1,
      totalTasks: 1,
    });
  });

  it("includes prop tasks and preserves partial-success counts for assets", () => {
    const tasks = [
      mediaTask("succeeded", "prop"),
      mediaTask("failed", "character"),
    ];
    const stages = getStudioStageStates(
      snapshot({
        novelText: "第一章",
        workflows: [
          workflow("story-to-script", "succeeded", "2026-08-26T01:00:00Z"),
        ],
        tasks,
      }),
      "episode-1",
    );

    expect(getTasksForStage(tasks, "assets")).toHaveLength(2);
    expect(stages[1]).toMatchObject({
      status: "failed",
      completedTasks: 1,
      failedTasks: 1,
      totalTasks: 2,
    });
  });
});

function snapshot(input?: {
  novelText?: string;
  tasks?: MediaTask[];
  workflows?: WorkspaceSnapshot["workflows"];
}): WorkspaceSnapshot {
  return {
    project: {
      id: "project-1",
      name: "Project",
      description: null,
      lastAccessedAt: null,
      createdAt: "2026-08-26T00:00:00Z",
      updatedAt: "2026-08-26T00:00:00Z",
      episodeCount: 1,
      failedTaskCount: 0,
      latestWorkflow: null,
      config: {
        analysisModel: null,
        characterModel: null,
        locationModel: null,
        storyboardModel: null,
        editModel: null,
        videoModel: null,
        audioModel: null,
        videoRatio: "9:16",
        videoResolution: "720p",
        artStyle: "comic",
        ttsRate: "+0%",
        workflowMode: "novel-promotion",
        globalAssetText: null,
        capabilityOverrides: {},
      },
      episodes: [
        {
          id: "episode-1",
          projectId: "project-1",
          episodeNumber: 1,
          name: "Episode 1",
          description: null,
          novelText: input?.novelText ?? null,
          createdAt: "2026-08-26T00:00:00Z",
          updatedAt: "2026-08-26T00:00:00Z",
        },
      ],
    },
    tasks: input?.tasks ?? [],
    workflows: input?.workflows ?? [],
  };
}

function workflow(
  workflowType: string,
  status: string,
  updatedAt: string,
): WorkspaceSnapshot["workflows"][number] {
  return {
    id: `${workflowType}-${status}`,
    traceId: "trace",
    spanId: "span",
    projectId: "project-1",
    episodeId: "episode-1",
    workflowType,
    status,
    createdAt: updatedAt,
    updatedAt,
    steps: [],
  };
}

function mediaTask(
  status: MediaTask["status"],
  targetType: MediaTask["targetType"] = "storyboard_panel",
): MediaTask {
  return {
    id: `task-${status}`,
    traceId: "trace",
    spanId: "span",
    projectId: "project-1",
    episodeId: "episode-1",
    targetType,
    targetId: "panel-1",
    kind: "image",
    status,
    provider: "test",
    protocol: "openai-compatible",
    model: "test",
    request: {},
    retryCount: 0,
    maxRetries: 2,
    progress: status === "succeeded" ? 100 : 20,
    createdAt: "2026-08-26T00:00:00Z",
    updatedAt: "2026-08-26T00:00:00Z",
  };
}
