import { prisma } from "@/lib/server/prisma";

/** Server-owned snapshot of the exact saved editor inputs for one local export. */
export async function captureTimelineRenderSnapshot(userId: string, projectId: string, episodeId: string) {
  const [storyboard, editorProject, voiceLines, episodeAudioTracks] =
    await Promise.all([
      prisma.storyboard.findFirst({
        where: { projectId, episodeId, project: { userId } },
        select: {
          panels: {
            orderBy: { panelIndex: "asc" },
            select: {
              id: true,
              panelIndex: true,
              imageAsset: { select: { url: true, storageKey: true } },
              videoAsset: { select: { url: true, storageKey: true } },
              lipSyncAsset: { select: { url: true, storageKey: true } },
              videoSegments: {
                select: {
                  id: true,
                  videoAsset: { select: { url: true, storageKey: true } },
                },
              },
            },
          },
        },
      }),
      prisma.editorProject.findFirst({
        where: {
          episodeId,
          episode: { projectId, project: { userId } },
        },
        select: { timelineJson: true, subtitleJson: true },
      }),
      prisma.voiceLine.findMany({
        where: { episodeId, episode: { projectId, project: { userId } } },
        orderBy: { lineIndex: "asc" },
        select: {
          id: true,
          lineIndex: true,
          speaker: true,
          content: true,
          delivery: true,
          matchedPanelId: true,
          durationSeconds: true,
          audioAssetId: true,
        },
      }),
      prisma.episodeAudioTrack.findMany({
        where: {
          episodeId,
          trackType: { in: ["merged", "ambience", "sfx", "music"] },
          episode: { projectId, project: { userId } },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          trackType: true,
          startSeconds: true,
          endSeconds: true,
          volume: true,
          metadataJson: true,
          asset: { select: { url: true, storageKey: true } },
        },
      }),
    ]);
  if (!storyboard || !editorProject) throw new Error("TIMELINE_RENDER_SOURCE_NOT_FOUND");
  return { version: 1 as const, userId, projectId, episodeId, storyboard, editorProject, voiceLines, episodeAudioTracks };
}

export type TimelineRenderSnapshot = Awaited<ReturnType<typeof captureTimelineRenderSnapshot>>;
export function readTimelineRenderSnapshot(value: unknown, scope: { userId: string; projectId: string; episodeId: string }): TimelineRenderSnapshot | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") throw new Error("TIMELINE_RENDER_SNAPSHOT_INVALID");
  const snapshot = value as TimelineRenderSnapshot;
  if (snapshot.version !== 1 || snapshot.userId !== scope.userId || snapshot.projectId !== scope.projectId || snapshot.episodeId !== scope.episodeId || !snapshot.editorProject || !Array.isArray(snapshot.storyboard?.panels) || !Array.isArray(snapshot.voiceLines) || !Array.isArray(snapshot.episodeAudioTracks)) throw new Error("TIMELINE_RENDER_SNAPSHOT_INVALID");
  return snapshot;
}
