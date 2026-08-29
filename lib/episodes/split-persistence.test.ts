import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const projectCount = vi.hoisted(() => vi.fn());
const manuscriptFindFirst = vi.hoisted(() => vi.fn());
const episodeFindMany = vi.hoisted(() => vi.fn());
const episodeCreateMany = vi.hoisted(() => vi.fn());
const sourceCreateMany = vi.hoisted(() => vi.fn());
const executeRaw = vi.hoisted(() => vi.fn());
const createdEpisodes = vi.hoisted(
  () => ({ value: [] as Array<Record<string, unknown>> }),
);

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    project: { count: projectCount },
    manuscript: { findFirst: manuscriptFindFirst },
    $transaction: async (
      callback: (transaction: Record<string, unknown>) => Promise<unknown>,
    ) =>
      callback({
        episode: {
          findMany: episodeFindMany,
          createMany: episodeCreateMany,
        },
        episodeSourceVersion: { createMany: sourceCreateMany },
        $executeRaw: executeRaw,
      }),
  },
}));

import { persistEpisodeSplits, type EpisodeSplitDraft } from "./split";

beforeEach(() => {
  vi.clearAllMocks();
  createdEpisodes.value = [];
  projectCount.mockResolvedValue(1);
  episodeCreateMany.mockImplementation(async ({ data }) => {
    createdEpisodes.value = data;
    return { count: data.length };
  });
  sourceCreateMany.mockImplementation(async ({ data }) => ({
    count: data.length,
  }));
  episodeFindMany
    .mockResolvedValueOnce([])
    .mockImplementation(async () => createdEpisodes.value);
});

describe("episode split persistence", () => {
  it("persists a 728-episode manuscript with batch inserts", async () => {
    const chunks = Array.from(
      { length: 728 },
      (_, index) => `第 ${index + 1} 章\n正文 ${index + 1}\n`,
    );
    const source = chunks.join("");
    let offset = 0;
    const episodes: EpisodeSplitDraft[] = chunks.map((content, index) => {
      const startIndex = offset;
      offset += content.length;
      return {
        number: index + 1,
        title: `第 ${index + 1} 集`,
        summary: `本集概要 ${index + 1}`,
        content: "",
        wordCount: content.length,
        startIndex,
        endIndex: offset,
      };
    });
    manuscriptFindFirst.mockResolvedValue({
      id: "manuscript-1",
      sourceText: source,
    });

    const result = await persistEpisodeSplits({
      userId: "user-1",
      projectId: "project-1",
      manuscriptId: "manuscript-1",
      episodes,
    });

    expect(episodeCreateMany).toHaveBeenCalledTimes(1);
    expect(episodeCreateMany.mock.calls[0][0].data).toHaveLength(728);
    expect(sourceCreateMany).toHaveBeenCalledTimes(1);
    expect(sourceCreateMany.mock.calls[0][0].data).toHaveLength(728);
    expect(executeRaw).not.toHaveBeenCalled();
    expect(result).toHaveLength(728);
  });

  it("creates a new source version when only source metadata changes", async () => {
    const source = `第1章 初见\n${"少年推开院门。".repeat(30)}`;
    const existing = {
      id: "episode-1",
      episodeNumber: 1,
      novelText: source,
      activeSourceId: "source-1",
      activeSourceKind: "original",
      storyboard: null,
      editorProject: null,
      sourceVersions: [
        {
          id: "source-1",
          manuscriptId: "manuscript-1",
          version: 1,
          title: "初见",
          summary: "================",
          sourceHash: createHash("sha256").update(source).digest("hex"),
          sourceStartIndex: 0,
          sourceEndIndex: source.length,
        },
      ],
      _count: {
        mediaTasks: 0,
        clips: 0,
        shots: 0,
        voiceLines: 0,
        audioTracks: 0,
        assetReferences: 0,
        workflowRuns: 0,
        productionDeliverables: 0,
      },
    };
    manuscriptFindFirst.mockResolvedValue({
      id: "manuscript-1",
      sourceText: source,
    });
    episodeFindMany.mockReset();
    episodeFindMany
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([existing]);

    await persistEpisodeSplits({
      userId: "user-1",
      projectId: "project-1",
      manuscriptId: "manuscript-1",
      episodes: [
        {
          number: 1,
          title: "初见",
          summary: "少年推开院门，看见多年未归的父亲站在雨中。",
          content: "",
          wordCount: source.length,
          startIndex: 0,
          endIndex: source.length,
        },
      ],
    });

    expect(sourceCreateMany).toHaveBeenCalledTimes(1);
    expect(sourceCreateMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({
        episodeId: "episode-1",
        version: 2,
        summary: "少年推开院门，看见多年未归的父亲站在雨中。",
      }),
    ]);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});
