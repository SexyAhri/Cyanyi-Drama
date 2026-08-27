import type { MediaTask } from "@/lib/media/task-contract";
import {
  emptyPostQc,
  parseSoundPostPackage,
  SOUND_QC_KEYS,
  type SoundPostPackage,
} from "@/lib/production/post-contract";

import type {
  ProductionDeliverableRecord,
  ProjectMediaAsset,
  VoiceLineRecord,
} from "../types";

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

export function buildSoundPostPackage(
  episodeId: string,
  lines: VoiceLineRecord[],
): SoundPostPackage {
  const qc = emptyPostQc(SOUND_QC_KEYS);
  qc.dialogue_sync = {
    status: "pass",
    measured: 0,
    target: 80,
    unit: "ms",
    note: "",
  };
  return {
    schemaVersion: 1,
    episodeId,
    dialogue: lines.map((line) => ({
      lineId: line.id,
      speaker: line.speaker,
      text: line.content,
      adrStatus: "not_required",
      reason: "",
      syncOffsetMs: 0,
    })),
    effects: [],
    music: [],
    mix: {
      format: "5.1 + stereo",
      sampleRate: 48_000,
      bitDepth: 24,
      targetLufs: -24,
      truePeakDbtp: -2,
    },
    qc,
  };
}

export function getSoundPostVersions(
  deliverables: ProductionDeliverableRecord[],
  episodeId: string,
) {
  return deliverables
    .filter(
      (item) =>
        item.department === "sound" &&
        item.deliverableType === "sound_post_package" &&
        item.scopeType === "episode" &&
        item.scopeId === episodeId,
    )
    .sort((left, right) => right.version - left.version)
    .map((deliverable) => {
      const parsed = parseSoundPostPackage(deliverable.payload);
      return {
        deliverable,
        package: parsed.success ? parsed.data : null,
      };
    });
}

export function getCurrentSoundPostVersion(
  versions: ReturnType<typeof getSoundPostVersions>,
) {
  return versions.find(
    (item) => !["stale", "superseded"].includes(item.deliverable.status),
  );
}

export function getSoundQcReadiness(soundPackage: SoundPostPackage) {
  const statuses = SOUND_QC_KEYS.map((key) => soundPackage.qc[key].status);
  return {
    passed: statuses.filter((status) => status === "pass").length,
    failed: statuses.filter((status) => status === "fail").length,
    total: statuses.length,
  };
}
