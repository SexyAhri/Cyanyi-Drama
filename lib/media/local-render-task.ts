import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/server/prisma";
import { assertEpisodeTimelineCurrent } from "@/lib/production/timeline-source-state";
import { captureTimelineRenderSnapshot } from "@/lib/production/render-snapshot";
import {
  inspectSubtitleTimings,
  parseSavedSubtitles,
} from "@/lib/production/subtitle-timing";
import { normalizeRenderSpecification } from "@/lib/providers/local/render-spec";
import { createMediaTask } from "./task-contract";
import { createDatabaseMediaTaskStore } from "./task-store";
import { enqueuePersistedMediaTask } from "./task-submit";
import { ProductionTaskError } from "./production-tasks";

export const LOCAL_RENDER_MODEL = "local-ffmpeg";

export function isLocalRenderTask(
  task: {
    targetType?: string | null;
    provider: string;
    protocol: string;
    model: string;
  },
  request: Record<string, unknown>,
) {
  return (
    task.targetType === "editor_render" &&
    task.provider === "local" &&
    task.protocol === "local" &&
    task.model === LOCAL_RENDER_MODEL &&
    request.operation === "render_timeline"
  );
}

export async function createLocalRenderTask(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  specification: Record<string, unknown>;
}) {
  const ownsEpisode = await prisma.episode.count({
    where: {
      id: input.episodeId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
  });
  if (!ownsEpisode) throw new ProductionTaskError("项目或剧集不存在", 404);
  try {
    await assertEpisodeTimelineCurrent(
      input.userId,
      input.projectId,
      input.episodeId,
    );
  } catch (error) {
    throw new ProductionTaskError(
      error instanceof Error ? error.message : "时间线素材已变化",
      409,
    );
  }
  const snapshot = await captureTimelineRenderSnapshot(
    input.userId,
    input.projectId,
    input.episodeId,
  );
  const timeline = JSON.parse(snapshot.editorProject.timelineJson) as {
    duration: number;
  };
  const subtitles = snapshot.editorProject.subtitleJson
    ? parseSavedSubtitles(JSON.parse(snapshot.editorProject.subtitleJson))
    : [];
  const issues = inspectSubtitleTimings(
    subtitles,
    timeline.duration,
    snapshot.voiceLines,
  );
  if (issues.length)
    throw new ProductionTaskError(
      issues.map((issue) => issue.message).join("；"),
      400,
    );
  const task = createMediaTask({
    id: `media_task_${randomUUID()}`,
    projectId: input.projectId,
    episodeId: input.episodeId,
    targetType: "editor_render",
    targetId: input.episodeId,
    kind: "video",
    provider: "local",
    protocol: "local",
    model: LOCAL_RENDER_MODEL,
    request: {
      operation: "render_timeline",
      ...normalizeRenderSpecification(input.specification),
      timelineRenderSnapshot: snapshot,
    },
  });
  const store = createDatabaseMediaTaskStore(input.userId);
  await store.create(task);
  return enqueuePersistedMediaTask(input.userId, task);
}
