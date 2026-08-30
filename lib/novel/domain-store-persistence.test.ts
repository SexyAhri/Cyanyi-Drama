import { beforeEach, describe, expect, it, vi } from "vitest";

const episodeCount = vi.hoisted(() => vi.fn());
const storyboardUpsert = vi.hoisted(() => vi.fn());
const storyClipCount = vi.hoisted(() => vi.fn());
const storyboardPanelFindMany = vi.hoisted(() => vi.fn());
const storyboardPanelUpdateMany = vi.hoisted(() => vi.fn());
const storyboardPanelUpsert = vi.hoisted(() => vi.fn());
const storyboardPanelDeleteMany = vi.hoisted(() => vi.fn());
const storyboardFindUniqueOrThrow = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    episode: { count: episodeCount },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        storyboard: {
          upsert: storyboardUpsert,
          findUniqueOrThrow: storyboardFindUniqueOrThrow,
        },
        storyClip: { count: storyClipCount },
        storyboardPanel: {
          findMany: storyboardPanelFindMany,
          updateMany: storyboardPanelUpdateMany,
          upsert: storyboardPanelUpsert,
          deleteMany: storyboardPanelDeleteMany,
        },
      }),
  },
}));

import { saveStoryboard } from "./domain-store";

beforeEach(() => {
  vi.clearAllMocks();
  episodeCount.mockResolvedValue(1);
  storyboardUpsert.mockResolvedValue({ id: "storyboard-1" });
  storyClipCount.mockResolvedValue(1);
  storyboardPanelFindMany.mockResolvedValue([
    {
      id: "panel-stable",
      clipId: "clip-1",
      clipPanelIndex: 0,
      panelIndex: 4,
      imagePrompt: "人工确认的旧图片提示词",
      videoPrompt: "人工确认的旧视频提示词",
      firstLastFramePrompt: "人工确认的首尾帧提示词",
      imageAssetId: "image-asset-1",
      imagePromptDesignJson: JSON.stringify({
        designNotes: ["旧设计重点"],
        continuitySafeguards: ["旧连续性"],
      }),
      videoPromptDesignJson: JSON.stringify({
        designNotes: ["旧视频设计重点"],
        continuitySafeguards: ["旧视频连续性"],
      }),
      firstLastFramePromptDesignJson: JSON.stringify({
        designNotes: ["旧首尾帧设计重点"],
        continuitySafeguards: ["旧首尾帧连续性"],
      }),
    },
  ]);
  storyboardPanelUpdateMany.mockResolvedValue({ count: 1 });
  storyboardPanelUpsert.mockResolvedValue({ id: "panel-stable" });
  storyboardPanelDeleteMany.mockResolvedValue({ count: 0 });
  storyboardFindUniqueOrThrow.mockResolvedValue(storyboardRow());
});

describe("storyboard persistence", () => {
  it("keeps a panel id stable by clip-local identity", async () => {
    await saveStoryboard("user-1", "project-1", "episode-1", {
      status: "ready",
      panels: [
        {
          clipId: "clip-1",
          clipPanelIndex: 0,
          panelIndex: 0,
          description: "更新后的分镜",
          sourceEvidence: ["原文"],
        },
      ],
    });

    expect(storyClipCount).toHaveBeenCalledWith({
      where: {
        id: { in: ["clip-1"] },
        episodeId: "episode-1",
        projectId: "project-1",
      },
    });
    expect(storyboardPanelUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "panel-stable" },
        update: expect.objectContaining({
          clipId: "clip-1",
          clipPanelIndex: 0,
          panelIndex: 0,
          sourceEvidenceJson: '["原文"]',
        }),
      }),
    );
  });

  it("preserves an existing image prompt during AI reruns without touching its image binding", async () => {
    await saveStoryboard("user-1", "project-1", "episode-1", {
      status: "ready",
      preserveImagePrompts: true,
      panels: [
        {
          clipId: "clip-1",
          clipPanelIndex: 0,
          panelIndex: 0,
          imagePrompt: "模型新生成但不应覆盖的提示词",
        },
      ],
    });

    expect(storyboardPanelUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "panel-stable" },
        update: expect.objectContaining({
          imagePrompt: "人工确认的旧图片提示词",
        }),
      }),
    );
    expect(storyboardPanelUpsert.mock.calls[0]?.[0]?.update).not.toHaveProperty(
      "imageAssetId",
    );
  });

  it("still allows explicit image prompt edits outside an AI rerun", async () => {
    await saveStoryboard("user-1", "project-1", "episode-1", {
      status: "ready",
      panels: [
        {
          clipId: "clip-1",
          clipPanelIndex: 0,
          panelIndex: 0,
          imagePrompt: "人工新提示词",
        },
      ],
    });

    expect(storyboardPanelUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ imagePrompt: "人工新提示词" }),
      }),
    );
  });

  it("persists prompt design details with their matching media mode", async () => {
    await saveStoryboard("user-1", "project-1", "episode-1", {
      status: "ready",
      panels: [
        {
          clipId: "clip-1",
          clipPanelIndex: 0,
          panelIndex: 0,
          imagePromptDesign: {
            designNotes: ["  锁定手部发力  "],
            continuitySafeguards: ["韩宇站位保持画左"],
          },
        },
      ],
    });

    expect(storyboardPanelUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          imagePromptDesignJson: JSON.stringify({
            designNotes: ["锁定手部发力"],
            continuitySafeguards: ["韩宇站位保持画左"],
          }),
        }),
      }),
    );
  });

  it("returns persisted design details as structured panel data", async () => {
    const result = await saveStoryboard("user-1", "project-1", "episode-1", {
      status: "ready",
      panels: [
        {
          clipId: "clip-1",
          clipPanelIndex: 0,
          panelIndex: 0,
        },
      ],
    });

    expect(result?.panels[0]?.videoPromptDesign).toEqual({
      designNotes: ["视频设计重点"],
      continuitySafeguards: ["视频连续性"],
    });
  });

  it("preserves saved design details when a workflow rerun omits them", async () => {
    await saveStoryboard("user-1", "project-1", "episode-1", {
      status: "ready",
      preserveImagePrompts: true,
      panels: [
        {
          clipId: "clip-1",
          clipPanelIndex: 0,
          panelIndex: 0,
          imagePrompt: "模型重新生成的提示词",
        },
      ],
    });

    expect(storyboardPanelUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          videoPrompt: "人工确认的旧视频提示词",
          firstLastFramePrompt: "人工确认的首尾帧提示词",
          imagePromptDesignJson: JSON.stringify({
            designNotes: ["旧设计重点"],
            continuitySafeguards: ["旧连续性"],
          }),
        }),
      }),
    );
  });

  it("rejects a clip outside the current episode", async () => {
    storyClipCount.mockResolvedValue(0);

    await expect(
      saveStoryboard("user-1", "project-1", "episode-1", {
        panels: [
          {
            clipId: "foreign-clip",
            clipPanelIndex: 0,
            panelIndex: 0,
          },
        ],
      }),
    ).rejects.toThrow("STORYBOARD_PANEL_CLIP_NOT_FOUND");
    expect(storyboardUpsert).not.toHaveBeenCalled();
  });
});

function storyboardRow() {
  const now = new Date();
  return {
    id: "storyboard-1",
    projectId: "project-1",
    episodeId: "episode-1",
    status: "ready",
    version: 2,
    sourceHash: "hash",
    createdAt: now,
    updatedAt: now,
    panels: [
      {
        id: "panel-stable",
        storyboardId: "storyboard-1",
        clipId: "clip-1",
        clipPanelIndex: 0,
        panelIndex: 0,
        shotType: null,
        cameraMove: null,
        description: "更新后的分镜",
        locationName: null,
        charactersJson: null,
        propsJson: null,
        imagePrompt: null,
        videoPrompt: null,
        imagePromptDesignJson: null,
        videoPromptDesignJson: JSON.stringify({
          designNotes: ["视频设计重点"],
          continuitySafeguards: ["视频连续性"],
        }),
        firstLastFramePromptDesignJson: null,
        phase: "continuity",
        status: "ready",
        srtStart: null,
        srtEnd: null,
        durationSeconds: null,
        subtitleText: null,
        actingNotesJson: null,
        photographyRules: null,
        firstLastFramePrompt: null,
        linkedToNextPanel: false,
        sourceEvidenceJson: '["原文"]',
        imageAssetId: null,
        videoAssetId: null,
        lipSyncAssetId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}
