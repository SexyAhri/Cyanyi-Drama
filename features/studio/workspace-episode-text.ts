import type { EpisodeRecord } from "@/lib/projects/types";

export type WorkspaceEpisode = EpisodeRecord & { novelTextUnchanged?: boolean };

/** Restore omitted text only when the exact saved episode revision is already held. */
export function restoreWorkspaceEpisodeText(incoming: WorkspaceEpisode[], previous: EpisodeRecord[]) {
  const saved = new Map(previous.map(episode => [episode.id, episode]));
  const restored: EpisodeRecord[] = [];
  for (const episode of incoming) {
    const { novelTextUnchanged, ...record } = episode;
    if (novelTextUnchanged) {
      const old = saved.get(episode.id);
      if (!old || old.updatedAt !== episode.updatedAt) return null;
      restored.push({ ...record, novelText: old.novelText });
    } else restored.push(record);
  }
  return restored;
}
