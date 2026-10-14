import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import {
  assertConfigurationScope,
  resolveProductionConfiguration,
} from "@/lib/production-configuration/store";
import { speechDeliveryEnabled } from "@/lib/production-configuration/sound-execution";

/** Materialize newly confirmed configuration speech only on an explicit TTS action. */
export async function synchronizeConfiguredVoiceLines(
  userId: string,
  projectId: string,
  episodeId: string,
) {
  return prisma.$transaction(
    async (tx) => {
      await assertConfigurationScope(userId, { projectId, episodeId }, tx);
      const panels = await tx.storyboardPanel.findMany({
        where: { storyboard: { projectId, episodeId } },
        orderBy: { panelIndex: "asc" },
        select: { id: true },
      });
      const maximum = await tx.voiceLine.aggregate({
        where: { episodeId },
        _max: { lineIndex: true },
      });
      let index = (maximum._max.lineIndex ?? -1) + 1;
      const ids: string[] = [];
      for (const panel of panels) {
        const snapshot = await resolveProductionConfiguration(
          userId,
          { projectId, episodeId, panelId: panel.id },
          tx,
        );
        for (const [position, speech] of (
          snapshot.sound.speechLines ?? []
        ).entries()) {
          if (!speechDeliveryEnabled(snapshot.sound, speech.delivery)) continue;
          if (speech.originLineId) {
            const original = await tx.voiceLine.findFirst({
              where: {
                id: speech.originLineId,
                episodeId,
                matchedPanelId: panel.id,
              },
              select: { id: true },
            });
            if (original) ids.push(original.id);
            continue;
          }
          const id = `configured_voice_${createHash("sha256").update(`${panel.id}:${position}`).digest("hex")}`;
          const current = await tx.voiceLine.findUnique({
            where: { id },
            select: { content: true, speaker: true, delivery: true },
          });
          const changed =
            current &&
            (current.content !== speech.content ||
              current.speaker !== speech.speaker ||
              current.delivery !== speech.delivery);
          const profile = snapshot.sound.voiceProfiles?.find(
            (profile) => profile.speaker === speech.speaker,
          );
          await tx.voiceLine.upsert({
            where: { id },
            create: {
              id,
              episodeId,
              matchedPanelId: panel.id,
              lineIndex: index++,
              speaker: speech.speaker,
              content: speech.content,
              delivery: speech.delivery,
              emotionPrompt: speech.direction,
              voiceProfilePrompt: profile?.direction,
              voicePresetId: profile?.voicePresetId,
            },
            update: {
              speaker: speech.speaker,
              content: speech.content,
              delivery: speech.delivery,
              emotionPrompt: speech.direction,
              voiceProfilePrompt: profile?.direction,
              voicePresetId: profile?.voicePresetId,
              ...(changed ? { status: "stale" } : {}),
            },
          });
          ids.push(id);
        }
      }
      return [...new Set(ids)];
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30_000,
    },
  );
}
