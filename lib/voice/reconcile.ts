import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";

type DialogueLine = {
  speaker: string;
  content: string;
  delivery: string;
  matchedPanelId: string | null;
  emotionPrompt?: string | null;
  emotionStrength?: number | null;
};
const contract = (line: DialogueLine) =>
  JSON.stringify([line.speaker, line.content, line.delivery]);

/** Match repeated lines in order, preserving preset, performance and audio for unchanged dialogue. */
export async function reconcileEpisodeVoiceLines(
  episodeId: string,
  lines: DialogueLine[],
) {
  return prisma.$transaction(
    async (tx) => {
      const previous = await tx.voiceLine.findMany({
        where: { episodeId },
        orderBy: { lineIndex: "asc" },
      });
      const available = new Map<string, typeof previous>();
      for (const line of previous) {
        const key = contract(line);
        available.set(key, [...(available.get(key) ?? []), line]);
      }
      const matched = lines.map((line) =>
        available.get(contract(line))?.shift(),
      );
      const retained = matched.flatMap((line) => (line ? [line.id] : []));
      const affected = new Set<string>();
      for (const old of previous) {
        if (!retained.includes(old.id) && old.matchedPanelId)
          affected.add(old.matchedPanelId);
      }
      // Unique episode/lineIndex requires moving retained indices out of the destination range first.
      const offset =
        Math.max(
          lines.length,
          ...previous.map((line) => line.lineIndex + 1),
          0,
        ) + 1;
      for (const [index, old] of previous.entries())
        await tx.voiceLine.update({
          where: { id: old.id },
          data: { lineIndex: offset + index },
        });
      await tx.voiceLine.deleteMany({
        where: { episodeId, id: { notIn: retained } },
      });
      for (const [index, line] of lines.entries()) {
        const old = matched[index];
        if (old) {
          if (old.matchedPanelId !== line.matchedPanelId) {
            if (old.matchedPanelId) affected.add(old.matchedPanelId);
            if (line.matchedPanelId) affected.add(line.matchedPanelId);
          }
          await tx.voiceLine.update({
            where: { id: old.id },
            data: { lineIndex: index, matchedPanelId: line.matchedPanelId },
          });
        } else {
          if (line.matchedPanelId) affected.add(line.matchedPanelId);
          await tx.voiceLine.create({
            data: {
              id: randomUUID(),
              episodeId,
              lineIndex: index,
              ...line,
              status: "draft",
            },
          });
        }
      }
      if (affected.size)
        await tx.storyboardPanel.updateMany({
          where: { id: { in: [...affected] }, storyboard: { episodeId } },
          data: { lipSyncAssetId: null },
        });
      return lines.length;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    },
  );
}
