import { beforeEach, describe, expect, it, vi } from "vitest";

const episodeCount = vi.hoisted(() => vi.fn());
const storyClipFindMany = vi.hoisted(() => vi.fn());
const storyClipDeleteMany = vi.hoisted(() => vi.fn());
const storyClipUpsert = vi.hoisted(() => vi.fn());
const storyShotDeleteMany = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/prisma", () => {
  const client = {
    episode: { count: episodeCount },
    storyClip: {
      findMany: storyClipFindMany,
      deleteMany: storyClipDeleteMany,
      upsert: storyClipUpsert,
    },
    storyShot: { deleteMany: storyShotDeleteMany },
  };
  return {
    prisma: {
      ...client,
      $transaction: transaction,
    },
  };
});

import { saveProductionClips } from "./domain-store";

beforeEach(() => {
  vi.clearAllMocks();
  episodeCount.mockResolvedValue(1);
  transaction.mockImplementation(
    async (run: (client: unknown) => Promise<unknown>) =>
      run({
        storyClip: {
          findMany: storyClipFindMany,
          deleteMany: storyClipDeleteMany,
          upsert: storyClipUpsert,
        },
        storyShot: { deleteMany: storyShotDeleteMany },
      }),
  );
  storyClipDeleteMany.mockResolvedValue({ count: 0 });
  storyShotDeleteMany.mockResolvedValue({ count: 0 });
  storyClipUpsert.mockResolvedValue({ id: "clip-stable" });
});

describe("production clip persistence", () => {
  it("preserves stable IDs, exact source whitespace, and reusable screenplay", async () => {
    storyClipFindMany
      .mockResolvedValueOnce([
        {
          id: "clip-stable",
          clipIndex: 0,
          content: " 甲\n",
          screenplay: '{"clipId":"clip-stable"}',
        },
      ])
      .mockResolvedValueOnce([]);

    await saveProductionClips("user-1", "project-1", "episode-1", [
      {
        clipIndex: 0,
        summary: "片段",
        content: " 甲\n",
        startText: " 甲",
        endText: "甲\n",
      },
    ]);

    expect(storyClipUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          episodeId_clipIndex: { episodeId: "episode-1", clipIndex: 0 },
        },
        create: expect.objectContaining({
          id: "clip-stable",
          content: " 甲\n",
          screenplay: '{"clipId":"clip-stable"}',
          status: "screenplay_ready",
        }),
        update: expect.objectContaining({
          content: " 甲\n",
          screenplay: '{"clipId":"clip-stable"}',
          status: "screenplay_ready",
        }),
      }),
    );
  });

  it("invalidates screenplay only when clip source changes", async () => {
    storyClipFindMany
      .mockResolvedValueOnce([
        {
          id: "clip-stable",
          clipIndex: 0,
          content: "旧原文",
          screenplay: '{"clipId":"clip-stable"}',
        },
      ])
      .mockResolvedValueOnce([]);

    await saveProductionClips("user-1", "project-1", "episode-1", [
      { clipIndex: 0, summary: "片段", content: "新原文" },
    ]);

    expect(storyClipUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          screenplay: null,
          status: "split_ready",
        }),
      }),
    );
  });
});
