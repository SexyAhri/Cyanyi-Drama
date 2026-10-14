import {
  configurationSnapshotSchema,
  DEFAULT_SOUND_POLICY,
  type SoundPolicy,
} from "./contract";

export function requestSoundPolicy(
  request: Record<string, unknown>,
  panelId?: string,
): SoundPolicy {
  const snapshots = request.panelSoundConfigurations;
  const scoped =
    panelId &&
    snapshots &&
    typeof snapshots === "object" &&
    !Array.isArray(snapshots)
      ? (snapshots as Record<string, unknown>)[panelId]
      : undefined;
  const value = scoped ?? request.productionConfiguration;
  if (value === undefined) return DEFAULT_SOUND_POLICY;
  return configurationSnapshotSchema.parse(value).sound;
}

export function speechDeliveryEnabled(sound: SoundPolicy, delivery: string, allowSilent = false) {
  return (
    (allowSilent || sound.mode !== "silent") &&
    (delivery === "inner_monologue"
      ? sound.innerMonologue
      : delivery === "voiceover"
        ? sound.voiceover
        : sound.dialogue)
  );
}

export function configuredSpeechForLine(
  sound: SoundPolicy,
  line: { id: string; speaker: string; content: string; delivery: string },
  allowSilent = false,
) {
  const configured = sound.speechLines?.find(
    (item) => item.originLineId === line.id || !item.originLineId && line.id.startsWith("configured_voice_") && item.speaker === line.speaker && item.content === line.content && item.delivery === line.delivery,
  );
  if (sound.speechLines !== undefined && !configured) return null;
  const speech = configured ?? line;
  return speechDeliveryEnabled(sound, speech.delivery, allowSilent) ? speech : null;
}
