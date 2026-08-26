import type { MediaTask } from "@/lib/media/task-contract";

import type { ProjectMediaAsset, VoiceLineRecord } from "../types";

export function latestVoiceTask(lineId: string, tasks: MediaTask[]) {
  return tasks
    .filter(
      (task) => task.targetType === "voice_line" && task.targetId === lineId,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

export function voiceLineAsset(
  line: VoiceLineRecord,
  tasks: MediaTask[],
  assets: ProjectMediaAsset[],
) {
  if (line.audioAssetId) {
    const persisted = assets.find((asset) => asset.id === line.audioAssetId);
    if (persisted) return persisted;
  }
  const task = latestVoiceTask(line.id, tasks);
  const output = task?.status === "succeeded" ? task.output?.[0] : undefined;
  return output
    ? {
        id: output.id,
        kind: output.kind,
        url: output.url,
        mimeType: output.mimeType ?? null,
        metadata: output.metadata ?? {},
        references: [],
        sourceTargetId: line.id,
        sourceTargetType: "voice_line",
        taskStatus: task.status,
        createdAt: task.updatedAt,
      }
    : undefined;
}

export function latestFailedVoiceTasks(lineIds: string[], tasks: MediaTask[]) {
  return lineIds.flatMap((lineId) => {
    const task = latestVoiceTask(lineId, tasks);
    return task?.status === "failed" ? [task] : [];
  });
}
