import type { Prisma } from "@prisma/client";
import {
  configurationSnapshotSchema,
  type ConfigurationScope,
  type ProductionConfigurationSnapshot,
  type SoundPolicy,
} from "./contract";
import { resolveProductionConfiguration } from "./store";
import { configuredSpeechForLine } from "./sound-execution";
type SpeechSource = {
  id: string;
  speaker: string;
  content: string;
  delivery: string;
};

const soundFields = (
  sound: SoundPolicy,
  kind: string,
  operation?: unknown,
  line?: SpeechSource,
): Record<string, unknown> => {
  if (kind === "audio" && operation !== "merge_episode_audio" && line) {
    const speech = configuredSpeechForLine(sound, line);
    return {
      mode: sound.mode === "silent",
      speechLines: speech
        ? {
            speaker: speech.speaker,
            content: speech.content,
            delivery: speech.delivery,
            direction: "direction" in speech ? speech.direction : undefined,
          }
        : null,
      voiceDirection: sound.voiceDirection,
      voiceProfiles: sound.voiceProfiles?.filter(
        (profile) => profile.speaker === (speech?.speaker ?? line.speaker),
      ),
    };
  }
  if (kind === "audio" && operation !== "merge_episode_audio")
    return {
      mode: sound.mode === "silent",
      dialogue: sound.dialogue,
      voiceover: sound.voiceover,
      innerMonologue: sound.innerMonologue,
      voiceDirection: sound.voiceDirection,
      speechLines: sound.speechLines,
      voiceProfiles: sound.voiceProfiles,
    };
  return {
    ...sound,
    ...(kind === "video" && operation !== "render_timeline"
      ? { subtitles: sound.subtitles === "model" }
      : {}),
  };
};
export function affectedSoundFields(
  previous: ProductionConfigurationSnapshot,
  current: ProductionConfigurationSnapshot,
  kind: string,
  operation?: unknown,
  line?: SpeechSource,
) {
  const overridden = new Set(
    previous.sources
      .filter((source) => source.scopeKey === "request")
      .flatMap((source) => source.fields ?? []),
  );
  // Apply overrides before deriving speech/profile fields: a type switch can
  // change the derived speech even when the speechLines field was inherited.
  const effectiveSound = { ...current.sound };
  for (const key of Object.keys(previous.sound) as Array<keyof SoundPolicy>) {
    if (overridden.has(`sound.${key}`))
      Object.assign(effectiveSound, { [key]: previous.sound[key] });
  }
  const old = soundFields(previous.sound, kind, operation, line);
  const next = soundFields(effectiveSound, kind, operation, line);
  return [...new Set([...Object.keys(old), ...Object.keys(next)])]
    .filter(
      (key) =>
        !overridden.has(`sound.${key}`) &&
        JSON.stringify(old[key]) !== JSON.stringify(next[key]),
    )
    .map((key) => `sound.${key}`);
}

export function affectedAgentFields(
  previous: ProductionConfigurationSnapshot,
  current: ProductionConfigurationSnapshot,
) {
  const requestOverrides = new Set(
    previous.sources
      .filter((source) => source.scopeKey === "request")
      .flatMap((source) => source.fields ?? []),
  );
  const keys = new Set([...Object.keys(previous.agents), ...Object.keys(current.agents)]);
  const changed: string[] = [];
  for (const agentId of keys) {
    const before = previous.agents[agentId] ?? {};
    const after = current.agents[agentId] ?? {};
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const path = `agents.${agentId}.${field}`;
      if (!requestOverrides.has(path) && JSON.stringify(before[field as keyof typeof before]) !== JSON.stringify(after[field as keyof typeof after]))
        changed.push(path);
    }
  }
  return changed;
}

type Task = {
  projectId: string | null;
  episodeId: string | null;
  targetType: string | null;
  targetId: string | null;
  kind: string;
  payload: unknown;
};
export async function mediaConfigurationChanges(
  tx: Prisma.TransactionClient,
  userId: string,
  task: Task,
  request: Record<string, unknown>,
) {
  const saved = configurationSnapshotSchema.safeParse(
    request.productionConfiguration,
  );
  if (!saved.success) return [];
  let panelId =
    task.targetType === "storyboard_panel"
      ? (task.targetId ?? undefined)
      : undefined;
  let speechSource: SpeechSource | undefined;
  if (task.targetType === "voice_line" && task.targetId) {
    const line = await tx.voiceLine.findFirst({
      where: { id: task.targetId, episode: { project: { userId } } },
      select: {
        matchedPanelId: true,
        id: true,
        speaker: true,
        content: true,
        delivery: true,
      },
    });
    panelId = line?.matchedPanelId ?? undefined;
    speechSource = line ?? undefined;
  }
  const scope = {
    projectId: task.projectId ?? undefined,
    episodeId: task.episodeId ?? undefined,
    panelId,
  };
  const current = await resolveProductionConfiguration(userId, scope, tx);
  const fields = ["audio", "video"].includes(task.kind)
    ? affectedSoundFields(saved.data, current, task.kind, request.operation, speechSource)
    : [];
  fields.push(...affectedAgentFields(saved.data, current));
  if (
    request.panelSoundConfigurations &&
    typeof request.panelSoundConfigurations === "object" &&
    !Array.isArray(request.panelSoundConfigurations)
  ) {
    for (const [id, value] of Object.entries(
      request.panelSoundConfigurations,
    )) {
      const prior = configurationSnapshotSchema.safeParse(value);
      if (!prior.success) continue;
      const next = await resolveProductionConfiguration(
        userId,
        { ...scope, panelId: id },
        tx,
      );
      if (["audio", "video"].includes(task.kind))
        fields.push(
          ...affectedSoundFields(
            prior.data,
            next,
            task.kind,
            request.operation,
          ).map((field) => `${id}:${field}`),
        );
    }
  }
  return fields;
}

export async function markConfigurationAssetsStale(
  tx: Prisma.TransactionClient,
  userId: string,
  scope: ConfigurationScope,
) {
  let cursor: string | undefined;
  for (;;) {
    const tasks = await tx.mediaTask.findMany({
      where: {
        userId,
        kind: { in: ["audio", "video"] },
        ...(scope.projectId ? { projectId: scope.projectId } : {}),
        ...(scope.episodeId ? { episodeId: scope.episodeId } : {}),
      },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        projectId: true,
        episodeId: true,
        targetType: true,
        targetId: true,
        kind: true,
        payload: true,
        assets: { select: { id: true, metadataJson: true } },
      },
    });
    for (const task of tasks) {
      if (!task.assets.length) continue;
      const request =
        (task.payload as { request?: Record<string, unknown> } | null)
          ?.request ?? {};
      const fields = await mediaConfigurationChanges(tx, userId, task, request);
      for (const asset of task.assets) {
        let metadata: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(asset.metadataJson ?? "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            metadata = parsed;
        } catch {
          /* Preserve the asset itself when legacy metadata is malformed. */
        }
        if (fields.length)
          metadata.productionConfigurationStale = {
            fields,
            updatedAt: new Date().toISOString(),
            reason: "published_configuration_changed",
          };
        else delete metadata.productionConfigurationStale;
        await tx.mediaAsset.update({
          where: { id: asset.id },
          data: { metadataJson: JSON.stringify(metadata) },
        });
      }
      if (fields.length && task.episodeId)
        await tx.editorProject.updateMany({
          where: { episodeId: task.episodeId },
          data: { renderStatus: "stale" },
        });
    }
    if (tasks.length < 100) break;
    cursor = tasks.at(-1)!.id;
  }
}
