import { describe, expect, it } from "vitest";
import { restoreWorkspaceEpisodeText } from "./workspace-episode-text";
import type { EpisodeRecord } from "@/lib/projects/types";
const episode: EpisodeRecord = { id: "one", projectId: "project", episodeNumber: 1, name: "第一集", description: null,
  novelText: "已有原文", activeSourceId: "source", activeSourceKind: "original", createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z" };
describe("incremental workspace episode text", () => {
  it("restores unchanged source text while taking fresh metadata", () => {
    expect(restoreWorkspaceEpisodeText([{ ...episode, novelText: null, novelTextUnchanged: true }], [episode])).toEqual([episode]);
  });
  it("does not replace newly changed or cleared text with cached text", () => {
    expect(restoreWorkspaceEpisodeText([{ ...episode, novelText: "新原文" }], [episode])?.[0].novelText).toBe("新原文");
    expect(restoreWorkspaceEpisodeText([{ ...episode, novelText: null }], [episode])?.[0].novelText).toBeNull();
  });
  it("requests a full snapshot when the saved revision is unavailable", () => {
    const incoming = [{ ...episode, novelText: null, novelTextUnchanged: true }];
    expect(restoreWorkspaceEpisodeText(incoming, [])).toBeNull();
    expect(restoreWorkspaceEpisodeText(incoming, [{ ...episode, updatedAt: "older" }])).toBeNull();
  });
  it("removes deleted episodes instead of preserving stale entries", () => {
    expect(restoreWorkspaceEpisodeText([], [episode])).toEqual([]);
  });
});
