import type { EpisodeRecord } from "@/lib/projects/types";

import type {
  StudioStageId,
  StudioStageState,
  StudioStageStatus,
  WorkflowRunSummary,
  WorkspaceSnapshot,
} from "./types";

export const STUDIO_STAGE_IDS: StudioStageId[] = [
  "writing",
  "assets",
  "storyboard",
  "shots",
  "audio",
  "delivery",
];

const ACTIVE_STATUSES = new Set(["queued", "running", "canceling"]);
const FAILED_STATUSES = new Set(["failed", "blocked"]);

export function getStudioStageStates(
  snapshot: WorkspaceSnapshot,
  episodeId?: string,
): StudioStageState[] {
  const episode = snapshot.project.episodes.find(
    (item) => item.id === episodeId,
  );
  const workflows = snapshot.workflows.filter(
    (run) => !episodeId || run.episodeId === episodeId,
  );
  const tasks = snapshot.tasks.filter(
    (task) => !episodeId || task.episodeId === episodeId,
  );
  const writingWorkflow = latestWorkflow(workflows, "story-to-script");
  const storyboardWorkflow = latestWorkflow(workflows, "script-to-storyboard");
  const assetTasks = tasks.filter((task) =>
    ["character", "location", "prop"].includes(task.targetType ?? ""),
  );
  const writingStatus = workflowStatus(
    writingWorkflow,
    episode?.novelText ? "ready" : "not_started",
    Boolean(episode),
  );
  const storyboardStatus = workflowStatus(
    storyboardWorkflow,
    writingStatus === "completed" ? "ready" : "blocked",
    Boolean(episode),
  );

  const shots = tasks.filter(
    (task) =>
      task.targetType === "storyboard_panel" &&
      (task.kind === "image" || task.kind === "video"),
  );
  const audio = tasks.filter((task) =>
    ["voice_line", "episode_audio", "lip_sync"].includes(task.targetType ?? ""),
  );
  const delivery = tasks.filter((task) => task.targetType === "editor_render");
  const assetStatus = taskStatus(
    assetTasks,
    writingStatus === "completed" ? "ready" : "blocked",
    Boolean(episode),
  );
  const shotStatus = taskStatus(
    shots,
    storyboardStatus === "completed" ? "ready" : "blocked",
    Boolean(episode),
  );
  const audioStatus = taskStatus(
    audio,
    storyboardStatus === "completed" ? "ready" : "blocked",
    Boolean(episode),
  );
  const deliveryStatus = taskStatus(
    delivery,
    shotStatus === "completed" ? "ready" : "blocked",
    Boolean(episode),
  );

  return [
    withWorkflow("writing", writingStatus, writingWorkflow),
    withTasks("assets", assetStatus, assetTasks),
    withWorkflow("storyboard", storyboardStatus, storyboardWorkflow),
    withTasks("shots", shotStatus, shots),
    withTasks("audio", audioStatus, audio),
    withTasks("delivery", deliveryStatus, delivery),
  ];
}

export function getTasksForStage(
  tasks: WorkspaceSnapshot["tasks"],
  stageId: StudioStageId,
) {
  if (stageId === "assets") {
    return tasks.filter((task) =>
      ["character", "location", "prop"].includes(task.targetType ?? ""),
    );
  }
  if (stageId === "shots") {
    return tasks.filter(
      (task) =>
        task.targetType === "storyboard_panel" &&
        (task.kind === "image" || task.kind === "video"),
    );
  }
  if (stageId === "audio") {
    return tasks.filter((task) =>
      ["voice_line", "episode_audio", "lip_sync"].includes(
        task.targetType ?? "",
      ),
    );
  }
  if (stageId === "delivery") {
    return tasks.filter((task) => task.targetType === "editor_render");
  }
  return [];
}

export function getWorkflowForStage(
  workflows: WorkflowRunSummary[],
  stageId: StudioStageId,
) {
  if (stageId === "writing") {
    return latestWorkflow(workflows, "story-to-script");
  }
  if (stageId === "storyboard") {
    return latestWorkflow(workflows, "script-to-storyboard");
  }
  return undefined;
}

export function runtimeStatusToStageStatus(
  status: string,
): StudioStageStatus {
  if (status === "succeeded") return "completed";
  if (status === "canceled") return "canceled";
  if (status === "paused") return "paused";
  if (FAILED_STATUSES.has(status)) return "failed";
  if (ACTIVE_STATUSES.has(status)) return "running";
  return "not_started";
}

export function getSelectedEpisode(
  episodes: EpisodeRecord[],
  episodeId?: string,
) {
  return episodes.find((episode) => episode.id === episodeId) ?? episodes[0];
}

function latestWorkflow(workflows: WorkflowRunSummary[], workflowType: string) {
  return workflows
    .filter((workflow) => workflow.workflowType === workflowType)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

function workflowStatus(
  workflow: WorkflowRunSummary | undefined,
  fallback: StudioStageStatus,
  hasEpisode: boolean,
): StudioStageStatus {
  if (!hasEpisode) return "blocked";
  if (!workflow) return fallback;
  if (workflow.status === "succeeded") return "completed";
  if (workflow.status === "canceled") return "canceled";
  if (workflow.status === "paused") return "paused";
  if (FAILED_STATUSES.has(workflow.status)) return "failed";
  if (ACTIVE_STATUSES.has(workflow.status)) return "running";
  return fallback;
}

function taskStatus(
  tasks: WorkspaceSnapshot["tasks"],
  fallback: StudioStageStatus,
  hasEpisode: boolean,
): StudioStageStatus {
  if (!hasEpisode) return "blocked";
  if (!tasks.length) return fallback;
  if (tasks.some((task) => ["queued", "running"].includes(task.status))) {
    return "running";
  }
  if (tasks.some((task) => task.status === "failed")) return "failed";
  if (tasks.some((task) => task.status === "succeeded")) return "completed";
  if (tasks.every((task) => task.status === "canceled")) return "canceled";
  return fallback;
}

function emptyStage(
  id: StudioStageId,
  status: StudioStageStatus,
): StudioStageState {
  return {
    id,
    status,
    completedTasks: 0,
    failedTasks: 0,
    totalTasks: 0,
  };
}

function withWorkflow(
  id: StudioStageId,
  status: StudioStageStatus,
  workflow?: WorkflowRunSummary,
): StudioStageState {
  return {
    ...emptyStage(id, status),
    workflow,
  };
}

function withTasks(
  id: StudioStageId,
  status: StudioStageStatus,
  tasks: WorkspaceSnapshot["tasks"],
): StudioStageState {
  return {
    id,
    status,
    completedTasks: tasks.filter((task) => task.status === "succeeded").length,
    failedTasks: tasks.filter((task) => task.status === "failed").length,
    totalTasks: tasks.length,
  };
}
