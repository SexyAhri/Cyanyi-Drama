import { beforeEach, describe, expect, it, vi } from "vitest";

const episodeFindFirst = vi.hoisted(() => vi.fn());
const episodeUpdate = vi.hoisted(() => vi.fn());
const sourceFindFirst = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    episode: {
      findFirst: episodeFindFirst,
      update: episodeUpdate,
    },
    episodeSourceVersion: {
      findFirst: sourceFindFirst,
    },
  },
}));

import {
  activateEpisodeSource,
  buildEpisodeContinuityContext,
  parseAdaptationText,
} from "./adaptation";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("episode adaptation local metadata", () => {
  it("reads AI-authored title and synopsis from a soft text format", () => {
    expect(
      parseAdaptationText(
        "标题：寒门少年\n梗概：韩宇苦练后得知母亲仍在世。\n正文：\n凛冽冬夜，韩宇仍在练武。",
      ),
    ).toEqual({
      title: "寒门少年",
      summary: "韩宇苦练后得知母亲仍在世。",
      content: "凛冽冬夜，韩宇仍在练武。",
    });
  });

  it("keeps unformatted AI prose instead of failing a format check", () => {
    expect(parseAdaptationText("凛冽冬夜，韩宇仍在练武。")).toEqual({
      title: null,
      summary: null,
      content: "凛冽冬夜，韩宇仍在练武。",
    });
  });
});

describe("episode adaptation continuity", () => {
  it("separates prior continuity from the next-episode hard boundary", () => {
    const context = buildEpisodeContinuityContext({
      episodeNumber: 2,
      previous: {
        episodeNumber: 1,
        name: "第一集",
        description: "韩宇接过古籍",
        novelText: `开场${"前".repeat(1_300)}上一集结尾`,
      },
      next: {
        episodeNumber: 3,
        name: "第三集",
        description: "宗门来人",
        novelText: `下一集开场${"后".repeat(1_300)}`,
      },
    });

    expect(context.previousEpisode?.boundaryText).toContain("上一集结尾");
    expect(context.previousEpisode?.boundaryText).not.toContain("开场");
    expect(context.nextEpisode?.boundaryText).toContain("下一集开场");
    expect(context.nextEpisode?.boundaryText).not.toContain("后".repeat(1_250));
    expect(context.policy).toContain("do not consume");
  });
});

describe("episode production source activation", () => {
  const source = {
    id: "adapted-source-1",
    episodeId: "episode-2",
    manuscriptId: null,
    kind: "adapted",
    version: 1,
    title: "强者之心",
    summary: "韩宇立下变强之志。",
    content: "改编正文",
    adaptationMode: "faithful",
    instructions: null,
    changeSummary: null,
    promptTrace: null,
    productionPlan: null,
    productionPlanVersion: null,
    channelId: "channel-1",
    model: "model-1",
    sourceHash: "hash",
    sourceStartIndex: 0,
    sourceEndIndex: 4,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
  };

  function episodeWithCounts(overrides: Partial<Record<string, number>> = {}) {
    return {
      id: "episode-2",
      name: "强者之心",
      activeSourceId: "original-source-1",
      storyboard: null,
      editorProject: null,
      _count: {
        mediaTasks: 0,
        clips: 0,
        shots: 0,
        voiceLines: 0,
        audioTracks: 0,
        assetReferences: 0,
        productionDeliverables: 0,
        ...overrides,
      },
    };
  }

  it("does not treat adaptation workflow history as downstream production data", async () => {
    episodeFindFirst.mockResolvedValue(episodeWithCounts());
    sourceFindFirst.mockResolvedValue(source);
    episodeUpdate.mockResolvedValue({});

    await expect(
      activateEpisodeSource({
        userId: "user-1",
        projectId: "project-1",
        episodeId: "episode-2",
        sourceId: source.id,
      }),
    ).resolves.toMatchObject({ id: source.id, kind: "adapted" });

    expect(episodeFindFirst.mock.calls[0][0].select._count.select).not.toHaveProperty(
      "workflowRuns",
    );
    expect(episodeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "episode-2" } }),
    );
  });

  it("still blocks replacement when screenplay clips exist", async () => {
    episodeFindFirst.mockResolvedValue(episodeWithCounts({ clips: 3 }));
    sourceFindFirst.mockResolvedValue(source);

    await expect(
      activateEpisodeSource({
        userId: "user-1",
        projectId: "project-1",
        episodeId: "episode-2",
        sourceId: source.id,
      }),
    ).rejects.toMatchObject({
      status: 409,
      details: { downstream: ["剧本片段"] },
    });
    expect(episodeUpdate).not.toHaveBeenCalled();
  });
});
