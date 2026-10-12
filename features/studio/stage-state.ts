import type { EpisodeRecord } from "@/lib/projects/types";
import type { MediaTask } from "@/lib/media/task-contract";

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
const ASSET_CATALOG_WORKFLOW_TYPES = new Set([
  "asset-visual-design",
  "character-reference-extraction",
  "visual-asset-extraction",
  "story-to-script",
  "episode-preproduction",
  "original-episode-generation",
]);

const WRITING_WORKFLOW_TYPES = new Set([
  "episode-adaptation",
  "original-episode-generation",
  "story-to-script",
  "episode-preproduction",
]);

export function getWorkflowContentRevision(workflow?: WorkflowRunSummary) {
  if (!workflow) return "none";
  return [
    workflow.id,
    workflow.status,
    ...workflow.steps.map(
      (step) =>
        `${step.id}:${step.status}:${step.attempt}:${step.completedAt ?? ""}`,
    ),
  ].join("|");
}

export function getWritingWorkflowRuns(workflows: WorkflowRunSummary[]) {
  const phase = getWorkflowForStage(workflows, "writing");
  return {
    adaptation: workflows.find(workflow => ["episode-adaptation", "original-episode-generation"].includes(workflow.workflowType)),
    production: phase?.workflowType === "episode-preproduction" ? phase : latestWorkflow(workflows, "story-to-script"),
  };
}

export function getWritingWorkflowContentRevision(
  workflows: WorkflowRunSummary[],
) {
  return workflows
    .filter((workflow) => WRITING_WORKFLOW_TYPES.has(workflow.workflowType))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(getWorkflowContentRevision)
    .join("||");
}

export function getTaskOutputRevision(tasks: MediaTask[]) {
  return tasks
    .map(
      (task) =>
        `${task.id}:${task.status}:${task.retryCount}:${task.completedAt ?? ""}`,
    )
    .join("|");
}

export function getWorkflowOutputRevision(workflows: WorkflowRunSummary[]) {
  return [...workflows].sort((a, b) => a.id.localeCompare(b.id)).map(getWorkflowContentRevision).join("||");
}

export function getAssetCatalogWorkflowRevision(
  workflows: WorkflowRunSummary[],
) {
  return workflows
    .filter((workflow) =>
      ASSET_CATALOG_WORKFLOW_TYPES.has(workflow.workflowType),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(getWorkflowContentRevision)
    .join("||");
}

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
    (task) => !episodeId || !task.episodeId || task.episodeId === episodeId,
  );
  const writingWorkflow = getWorkflowForStage(workflows, "writing");
  const productionWorkflow = getWritingWorkflowRuns(workflows).production;
  const storyboardWorkflow = getWorkflowForStage(workflows, "storyboard");
  const assetTasks = tasks.filter((task) =>
    ["character", "character_appearance", "location", "location_image", "prop"].includes(task.targetType ?? ""),
  );
  const writingStatus = writingStageStatus({
    current: writingWorkflow,
    production: productionWorkflow,
    fallback: episode?.novelText ? "ready" : "not_started",
    hasEpisode: Boolean(episode),
  });
  const storyboardStatus = workflowStatus(
    storyboardWorkflow,
    writingStatus === "completed" ? "ready" : "blocked",
    Boolean(episode),
  );

  const shots = tasks.filter(isShotTask);
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
  const audioWorkflow = getWorkflowForStage(workflows, "audio");
  const displayedAudioStatus =
    audioWorkflow &&
    ["queued", "running", "canceling", "paused", "failed", "blocked"].includes(
      audioWorkflow.status,
    )
      ? runtimeStatusToStageStatus(audioWorkflow.status)
      : audioStatus;

  const stages = [
    withWorkflow("writing", writingStatus, writingWorkflow),
    withTasks("assets", assetStatus, assetTasks),
    withWorkflow("storyboard", storyboardStatus, storyboardWorkflow),
    withTasks("shots", shotStatus, shots),
    {
      ...withTasks("audio", displayedAudioStatus, audio),
      workflow: audioWorkflow,
    },
    withTasks("delivery", deliveryStatus, delivery),
  ];
  const records = episodeId ? snapshot.readiness?.episodes[episodeId] : undefined;
  if (!records || !snapshot.readiness) return stages;
  const assets = snapshot.readiness.assets;
  const complete: Record<StudioStageId, boolean> = {
    writing: records.structuredScript,
    assets: assets.total > 0 && assets.adopted === assets.total,
    storyboard: records.storyboardApproved,
    shots: records.panels > 0 && records.adoptedVideos === records.panels,
    audio: records.storyboardApproved && (records.voiceLines > 0 ? records.generatedVoices === records.voiceLines : records.speechExpected === false),
    delivery: records.rendered,
  };
  const ready: Record<StudioStageId, boolean> = {
    writing: Boolean(episode?.novelText), assets: records.structuredScript || assets.total > 0,
    storyboard: records.structuredScript, shots: records.storyboardApproved,
    audio: records.storyboardApproved, delivery: records.panels > 0 && records.adoptedVideos === records.panels,
  };
  return stages.map(stage => ({ ...stage,
    status: stage.status === "running" || stage.status === "paused" ? stage.status :
      complete[stage.id] ? "completed" : stage.status === "failed" ? "failed" :
      ready[stage.id] ? "ready" : "blocked",
  }));
}

export function getTasksForStage(
  tasks: WorkspaceSnapshot["tasks"],
  stageId: StudioStageId,
) {
  if (stageId === "assets") {
    return tasks.filter((task) =>
      ["character", "character_appearance", "location", "location_image", "prop"].includes(task.targetType ?? ""),
    );
  }
  if (stageId === "shots") {
    return tasks.filter(isShotTask);
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

function isShotTask(task: WorkspaceSnapshot["tasks"][number]) {
  return (
    (["canvas_node", "vfx_element", "vfx_composite"].includes(task.targetType ?? "") &&
      (task.kind === "image" || task.kind === "video")) ||
    (task.targetType === "storyboard_panel" &&
      (task.kind === "image" || task.kind === "video"))
  );
}

export function getWorkflowForStage(
  workflows: WorkflowRunSummary[],
  stageId: StudioStageId,
) {
  const stepKeys: Partial<Record<StudioStageId, string[]>> = {
    writing: ["organize_production_script"], storyboard: ["build_scene_storyboard"],
    audio: ["analyze_episode_voice", "design_voice_performance"],
  };
  const combined = latestWorkflow(workflows, "episode-preproduction");
  const phase = combined?.steps.filter(step => stepKeys[stageId]?.includes(step.key));
  if (combined && phase?.length) {
    const directTypes: Partial<Record<StudioStageId, string[]>> = { writing: ["story-to-script", "episode-adaptation", "original-episode-generation"], storyboard: ["script-to-storyboard"], audio: ["voice-analysis", "voice-performance-design"] };
    const newer = workflows.some(run => directTypes[stageId]?.includes(run.workflowType) && run.createdAt > combined.createdAt);
    if (!newer) {
      const current = phase.find(step => step.status !== "succeeded") ?? phase[phase.length - 1];
      const controlled = current.status !== "succeeded" && ["paused", "canceled", "canceling"].includes(combined.status);
      return { ...combined, status: controlled ? combined.status : current.status === "pending" ? "not_started" : current.status, steps: phase };
    }
  }
  if (stageId === "writing") {
    return currentWritingWorkflow(workflows);
  }
  if (stageId === "storyboard") {
    return latestWorkflow(workflows, "script-to-storyboard");
  }
  if (stageId === "audio") {
    return workflows.find((workflow) =>
      ["voice-analysis", "voice-performance-design"].includes(
        workflow.workflowType,
      ),
    );
  }
  return undefined;
}

export function runtimeStatusToStageStatus(status: string): StudioStageStatus {
  if (status === "succeeded") return "completed";
  if (status === "canceled") return "canceled";
  if (status === "paused") return "paused";
  if (status === "blocked") return "blocked";
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

function currentWritingWorkflow(workflows: WorkflowRunSummary[]) {
  const writingRuns = workflows
    .filter((workflow) => WRITING_WORKFLOW_TYPES.has(workflow.workflowType))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return (
    writingRuns.find((workflow) =>
      ["queued", "running", "canceling", "paused"].includes(workflow.status),
    ) ?? writingRuns[0]
  );
}

function writingStageStatus(input: {
  current?: WorkflowRunSummary;
  production?: WorkflowRunSummary;
  fallback: StudioStageStatus;
  hasEpisode: boolean;
}) {
  if (!input.hasEpisode) return "blocked";
  if (
    input.current &&
    ["queued", "running", "canceling", "canceled", "paused", "failed", "blocked"].includes(
      input.current.status,
    )
  ) {
    return workflowStatus(input.current, input.fallback, true);
  }
  if (input.production?.status === "succeeded") return "completed";
  return input.fallback;
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
