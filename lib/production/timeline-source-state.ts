import { prisma } from "@/lib/server/prisma";
import { syncTimelineSources, type TimelineMediaTrack } from "./timeline-source-sync";

export async function assertEpisodeTimelineCurrent(userId: string, projectId: string, episodeId: string) {
  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, projectId, project: { userId } },
    select: {
      editorProject: { select: { timelineJson: true } },
      storyboard: { select: { panels: { select: {
        id: true, imageAssetId: true, videoAssetId: true, lipSyncAssetId: true,
        videoSegments: { select: { id: true, videoAssetId: true } },
      } } } },
    },
  });
  if (!episode?.editorProject) throw new Error("请先生成并保存时间线");
  let timeline: { tracks: TimelineMediaTrack[] };
  try { timeline = JSON.parse(episode.editorProject.timelineJson); }
  catch { throw new Error("时间线数据无效，请重新保存"); }
  if (!Array.isArray(timeline.tracks) || !timeline.tracks.length) throw new Error("时间线没有镜头");
  const sync = syncTimelineSources(timeline, episode.storyboard?.panels ?? []);
  if (sync.incompatibleIds.length) throw new Error("镜头已删除或分段变化，请重新编排并保存时间线后再导出");
  if (sync.changedIds.length) throw new Error("已采用素材已变化，请更新时间线素材引用并保存后再导出");
}
