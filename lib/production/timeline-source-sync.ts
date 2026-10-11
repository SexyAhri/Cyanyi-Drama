export type TimelineMediaTrack = {
  id: string; panelId?: string; imageAssetId: string | null; videoAssetId: string | null;
  lipSyncAssetId: string | null; type: "image" | "video";
};
type PanelMedia = {
  id: string; imageAssetId: string | null; videoAssetId: string | null; lipSyncAssetId: string | null;
  videoSegments: Array<{ id: string; videoAssetId: string | null }>;
};

/** Refresh adopted media only. Track order, trims, timing, transitions and volume remain unchanged. */
export function syncTimelineSources<T extends { tracks: TimelineMediaTrack[] }>(timeline: T, panels: PanelMedia[]) {
  const byId = new Map(panels.map(panel => [panel.id, panel]));
  const changedIds: string[] = [], incompatibleIds: string[] = [];
  const tracks = timeline.tracks.map(track => {
    if (!track.panelId) return track;
    const panel = byId.get(track.panelId);
    if (!panel) { incompatibleIds.push(track.id); return track; }
    const segment = panel.videoSegments.find(item => item.id === track.id);
    // A changed segmentation cannot be fitted into manual trims without an editing decision.
    if ((track.id !== panel.id && !segment) || (track.id === panel.id && panel.videoSegments.length > 1)) {
      incompatibleIds.push(track.id); return track;
    }
    const videoAssetId = segment?.videoAssetId ?? panel.videoAssetId;
    const lipSyncAssetId = panel.videoSegments.length <= 1 ? panel.lipSyncAssetId : null;
    const type: TimelineMediaTrack["type"] = videoAssetId || lipSyncAssetId ? "video" : "image";
    if (track.imageAssetId === panel.imageAssetId && track.videoAssetId === videoAssetId && track.lipSyncAssetId === lipSyncAssetId && track.type === type) return track;
    changedIds.push(track.id);
    return { ...track, imageAssetId: panel.imageAssetId, videoAssetId, lipSyncAssetId, type };
  });
  return { timeline: { ...timeline, tracks } as T, changedIds, incompatibleIds };
}
