import { prisma } from "@/lib/server/prisma";

export type ProjectVoiceIdentity = {
  speaker: string;
  voiceProfilePrompt: string | null;
  voicePresetId: string | null;
};

export async function loadProjectVoiceIdentities(
  userId: string,
  projectId: string,
) {
  const rows = await prisma.voiceLine.findMany({
    where: {
      episode: { projectId, project: { userId } },
      OR: [
        { voiceProfilePrompt: { not: null } },
        { voicePresetId: { not: null } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 5_000,
    select: {
      speaker: true,
      voiceProfilePrompt: true,
      voicePresetId: true,
    },
  });
  return mergeProjectVoiceIdentities(rows);
}

export function mergeProjectVoiceIdentities(
  rows: ReadonlyArray<ProjectVoiceIdentity>,
) {
  const identities = new Map<string, ProjectVoiceIdentity>();
  for (const row of rows) {
    const speaker = row.speaker.trim();
    if (!speaker) continue;
    const current = identities.get(speaker);
    identities.set(speaker, {
      speaker,
      voiceProfilePrompt:
        current?.voiceProfilePrompt ?? row.voiceProfilePrompt?.trim() ?? null,
      voicePresetId: current?.voicePresetId ?? row.voicePresetId ?? null,
    });
  }
  return identities;
}
