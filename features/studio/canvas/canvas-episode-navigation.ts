export type CanvasEpisodeOption = { id: string; episodeNumber: number; name: string };

export function canvasEpisodeNavigation(episodes: CanvasEpisodeOption[], episodeId: string) {
  const ordered = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber || a.id.localeCompare(b.id));
  const index = ordered.findIndex(episode => episode.id === episodeId);
  return { ordered, previous: index > 0 ? ordered[index - 1] : undefined, next: index >= 0 ? ordered[index + 1] : undefined };
}

/** Keep the canvas and current stage open; discard selection belonging to the old episode. */
export async function switchCanvasEpisode(
  search: string,
  episodeId: string,
  save: () => Promise<boolean>,
  navigate: (query: string) => void,
) {
  if (!(await save())) return false;
  const params = new URLSearchParams(search);
  params.set("episode", episodeId);
  params.set("view", "canvas");
  for (const key of ["panel", "task", "run"]) params.delete(key);
  navigate(params.toString());
  return true;
}
