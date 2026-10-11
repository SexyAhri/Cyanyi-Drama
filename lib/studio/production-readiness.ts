import { syncTimelineSources, type TimelineMediaTrack } from "@/lib/production/timeline-source-sync";
import { prisma } from "@/lib/server/prisma";

export type ProductionReadiness = {
  episodes: Record<string, {
    structuredScript: boolean; storyboard: boolean; storyboardApproved: boolean;
    panels: number; adoptedImages: number; adoptedVideos: number;
    voiceLines: number; generatedVoices: number; timeline: boolean; rendered: boolean;
  }>;
  assets: { total: number; adopted: number };
};

/** Read production records, independent of the recent activity window. */
export async function loadProductionReadiness(userId: string, projectId: string): Promise<ProductionReadiness> {
  const where = { projectId, project: { userId } };
  const [episodes, characters, locations, props, propReferences] = await Promise.all([
    prisma.episode.findMany({ where, select: { id: true,
      clips: { select: { screenplay: true } },
      storyboard: { select: { status: true, panels: { select: { id: true, imageAssetId: true, videoAssetId: true, lipSyncAssetId: true, videoSegments: { select: { id: true, videoAssetId: true } } } } } },
      voiceLines: { select: { audioAssetId: true } },
      editorProject: { select: { outputAssetId: true, renderStatus: true, timelineJson: true } },
    } }),
    prisma.novelCharacter.findMany({ where, select: { appearances: { where: { selected: true, imageAssetId: { not: null } }, select: { id: true } } } }),
    prisma.novelLocation.findMany({ where, select: { selectedImage: { select: { imageAssetId: true } } } }),
    prisma.novelProp.findMany({ where, select: { id: true } }),
    prisma.assetReference.findMany({ where: { projectId, project: { userId }, entityType: "prop", role: "selected" }, select: { entityId: true } }),
  ]);
  const adoptedProps = new Set(propReferences.map(item => item.entityId));
  return {
    assets: { total: characters.length + locations.length + props.length,
      adopted: characters.filter(item => item.appearances.length > 0).length + locations.filter(item => item.selectedImage?.imageAssetId).length + props.filter(item => adoptedProps.has(item.id)).length },
    episodes: Object.fromEntries(episodes.map(episode => {
      const panels = episode.storyboard?.panels ?? [];
      let timelineCurrent = false;
      if (episode.editorProject) {
        try {
          const timeline = JSON.parse(episode.editorProject.timelineJson) as { tracks: TimelineMediaTrack[] };
          if (Array.isArray(timeline.tracks) && timeline.tracks.length) {
            const sync = syncTimelineSources(timeline, panels);
            timelineCurrent = !sync.changedIds.length && !sync.incompatibleIds.length;
          }
        } catch { /* Invalid timeline is not ready for delivery. */ }
      }
      return [episode.id, {
        structuredScript: episode.clips.length > 0 && episode.clips.every(clip => Boolean(clip.screenplay)),
        storyboard: panels.length > 0,
        storyboardApproved: panels.length > 0 && episode.storyboard?.status !== "director_review_required",
        panels: panels.length, adoptedImages: panels.filter(panel => panel.imageAssetId).length,
        adoptedVideos: panels.filter(panel => panel.videoAssetId).length,
        voiceLines: episode.voiceLines.length, generatedVoices: episode.voiceLines.filter(line => line.audioAssetId).length,
        timeline: Boolean(episode.editorProject), rendered: Boolean(timelineCurrent && episode.editorProject?.outputAssetId && episode.editorProject?.renderStatus === "succeeded"),
      }];
    })),
  };
}
