import { describe, expect, it } from "vitest";

import type { MediaTask } from "@/lib/media/task-contract";

import {
  getAssetCatalogWorkflowRevision,
  getStudioStageStates,
  getTaskOutputRevision,
  getTasksForStage,
  getWorkflowContentRevision,
  getWorkflowForStage,
  getWorkflowOutputRevision,
  getWritingWorkflowContentRevision,
  getWritingWorkflowRuns,
} from "./stage-state";
import type { WorkspaceSnapshot } from "./types";

describe("studio stage state", () => {
  it.each([true, false])("requires speech evidence before marking zero-line audio complete (%s)", speechExpected => {
    const state = snapshot({ novelText: "原文" });
    state.readiness = { assets: { total: 0, adopted: 0 }, episodes: { "episode-1": {
      structuredScript: true, storyboard: true, storyboardApproved: true,
      panels: 1, adoptedImages: 0, adoptedVideos: 0, voiceLines: 0, generatedVoices: 0,
      speechExpected, timeline: false, rendered: false,
    } } };
    expect(getStudioStageStates(state, "episode-1")[4].status).toBe(speechExpected ? "ready" : "completed");
  });
  it.each(["paused", "canceled", "canceling"])("preserves %s for unfinished combined phases", status => {
    const combined = { ...workflow("episode-preproduction", status, "2026-10-12T01:00:00Z"), steps: [
      { id: "writing", key: "organize_production_script", type: "organize_production_script", status: "pending", attempt: 0, index: 0, maxAttempts: 3, retryable: true },
      { id: "storyboard", key: "build_scene_storyboard", type: "build_scene_storyboard", status: "pending", attempt: 0, index: 1, maxAttempts: 3, retryable: true },
    ] };
    expect(getWorkflowForStage([combined], "writing")?.status).toBe(status);
    expect(getWorkflowForStage([combined], "storyboard")?.status).toBe(status);
    expect(getStudioStageStates(snapshot({ novelText: "原文", workflows: [combined] }), "episode-1")[0].status).toBe(status === "canceling" ? "running" : status);
  });
  it("includes VFX element and composite tasks in shot production", () => {
    const tasks = [
      mediaTask("running", "vfx_element"),
      { ...mediaTask("failed", "vfx_composite"), kind: "video" as const },
      { ...mediaTask("succeeded", "voice_line"), kind: "audio" as const },
    ];
    expect(getTasksForStage(tasks, "shots").map((task) => task.targetType)).toEqual([
      "vfx_element",
      "vfx_composite",
    ]);
  });
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

  it("counts persisted workflow steps and partial failures for stage progress", () => {
    const storyboard = {
      ...workflow("script-to-storyboard", "running", "2026-08-26T02:00:00Z"),
      steps: [
        { id: "a", key: "a", type: "a", status: "succeeded", attempt: 1, index: 0, maxAttempts: 3, retryable: true },
        { id: "b", key: "b", type: "b", status: "failed", attempt: 1, index: 1, maxAttempts: 3, retryable: true },
        { id: "c", key: "c", type: "c", status: "pending", attempt: 0, index: 2, maxAttempts: 3, retryable: true },
      ],
    };
    expect(getStudioStageStates(snapshot({ novelText: "第一章", workflows: [storyboard] }), "episode-1")[2])
      .toMatchObject({ completedTasks: 1, failedTasks: 1, totalTasks: 3, status: "running" });
  });

  it("surfaces an active adaptation as writing work before local placement", () => {
    const workflows = [
      workflow("episode-adaptation", "running", "2026-08-26T02:00:00Z"),
    ];
    const stages = getStudioStageStates(
      snapshot({ novelText: "第一章", workflows }),
      "episode-1",
    );

    expect(stages[0]).toMatchObject({
      status: "running",
      workflow: { workflowType: "episode-adaptation" },
    });
    expect(getWritingWorkflowRuns(workflows).adaptation).toBe(workflows[0]);
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

describe("studio runtime revisions", () => {
  it("refreshes assets after script organization and combined preparation", () => {
    for (const type of ["story-to-script", "episode-preproduction", "original-episode-generation"]) {
      const current = workflow(type, "running", "2026-10-12T01:00:00Z");
      expect(getAssetCatalogWorkflowRevision([current])).not.toBe("");
      expect(getAssetCatalogWorkflowRevision([{ ...current, status: "succeeded" }])).not.toBe(getAssetCatalogWorkflowRevision([current]));
    }
  });
  it("invalidates output on step completion, ignoring ordering and heartbeats", () => {
    const a = workflow("story-to-script", "running", "2026-10-12T01:00:00Z");
    const b = workflow("script-to-storyboard", "queued", "2026-10-12T01:00:00Z");
    expect(getWorkflowOutputRevision([a, b])).toBe(getWorkflowOutputRevision([b, { ...a, updatedAt: "2026-10-12T02:00:00Z" }]));
    expect(getWorkflowOutputRevision([a, b])).not.toBe(getWorkflowOutputRevision([{ ...a, status: "succeeded" }, b]));
  });
  it("ignores heartbeat timestamps but changes for workflow progress", () => {
    const current = workflow("story-to-script", "running", "2026-08-26T01:00:00Z");
    const heartbeat = { ...current, updatedAt: "2026-08-26T01:00:05Z" };
    const completed = { ...heartbeat, status: "succeeded" };

    expect(getWorkflowContentRevision(heartbeat)).toBe(
      getWorkflowContentRevision(current),
    );
    expect(getWorkflowContentRevision(completed)).not.toBe(
      getWorkflowContentRevision(current),
    );
  });

  it("ignores media heartbeats but changes when output becomes ready", () => {
    const current = mediaTask("running");
    const heartbeat = {
      ...current,
      progress: 50,
      updatedAt: "2026-08-26T01:00:05Z",
    };
    const completed = {
      ...heartbeat,
      status: "succeeded" as const,
      completedAt: "2026-08-26T01:00:06Z",
    };

    expect(getTaskOutputRevision([heartbeat])).toBe(
      getTaskOutputRevision([current]),
    );
    expect(getTaskOutputRevision([completed])).not.toBe(
      getTaskOutputRevision([current]),
    );
  });

  it("changes the asset catalog revision as asset workflows progress", () => {
    const queued = workflow(
      "asset-visual-design",
      "queued",
      "2026-08-26T01:00:00Z",
    );
    const running = { ...queued, status: "running" };
    const completed = {
      ...running,
      status: "succeeded",
      completedAt: "2026-08-26T01:00:06Z",
    };

    expect(getAssetCatalogWorkflowRevision([running])).not.toBe(
      getAssetCatalogWorkflowRevision([queued]),
    );
    expect(getAssetCatalogWorkflowRevision([completed])).not.toBe(
      getAssetCatalogWorkflowRevision([running]),
    );
  });

  it("ignores unrelated workflows in the asset catalog revision", () => {
    const assetWorkflow = workflow(
      "visual-asset-extraction",
      "succeeded",
      "2026-08-26T01:00:00Z",
    );
    const unrelated = workflow(
      "manuscript-analysis",
      "running",
      "2026-08-26T02:00:00Z",
    );

    expect(getAssetCatalogWorkflowRevision([assetWorkflow, unrelated])).toBe(
      getAssetCatalogWorkflowRevision([assetWorkflow]),
    );
  });

  it("refreshes writing content for adaptation and placement transitions", () => {
    const adaptation = workflow(
      "episode-adaptation",
      "running",
      "2026-08-26T01:00:00Z",
    );
    const completed = { ...adaptation, status: "succeeded" };
    const unrelated = workflow(
      "script-to-storyboard",
      "running",
      "2026-08-26T02:00:00Z",
    );

    expect(getWritingWorkflowContentRevision([completed])).not.toBe(
      getWritingWorkflowContentRevision([adaptation]),
    );
    expect(getWritingWorkflowContentRevision([adaptation, unrelated])).toBe(
      getWritingWorkflowContentRevision([adaptation]),
    );
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
        visualEra: "source",
        visualEraCustom: null,
        ttsRate: "+0%",
        episodeTargetDurationSeconds: 85,
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
          activeSourceId: input?.novelText ? "source-original-1" : null,
          activeSourceKind: "original",
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
