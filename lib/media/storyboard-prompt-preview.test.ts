import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectConfigFindUnique: vi.fn(),
  storyboardPanelFindFirst: vi.fn(),
  voiceLineFindMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    projectConfig: { findUnique: mocks.projectConfigFindUnique },
    storyboardPanel: { findFirst: mocks.storyboardPanelFindFirst },
    voiceLine: { findMany: mocks.voiceLineFindMany },
  },
}));

import { previewStoryboardPanelPrompt } from "./project-asset-tasks";

describe("storyboard prompt preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectConfigFindUnique.mockResolvedValue({ artStyle: "chinese-ink" });
    mocks.voiceLineFindMany.mockResolvedValue([]);
    mocks.storyboardPanelFindFirst.mockResolvedValue(panel());
  });

  it("shows project style and provider safety rewrites before image submission", async () => {
    const preview = await previewStoryboardPanelPrompt({
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      panelId: "panel-1",
      kind: "image",
    });

    expect(preview.compiledPrompt).toContain(
      "项目统一画风（最高优先级）：中国水墨动画风格",
    );
    expect(preview.compiledPrompt).toContain("嘴角溢出鲜血");
    expect(preview.finalPrompt).toContain("嘴角留有少量红色水迹");
    expect(preview.safetyRewrites).toEqual([
      expect.objectContaining({ category: "visible_blood" }),
    ]);
  });

  it("reports missing video references and dialogue audio without creating a task", async () => {
    mocks.voiceLineFindMany.mockResolvedValue([
      {
        speaker: "林玄",
        content: "退后。",
        delivery: "dialogue",
        durationSeconds: 1.2,
        audioAssetId: null,
      },
    ]);

    const preview = await previewStoryboardPanelPrompt({
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      panelId: "panel-1",
      kind: "video",
      mode: "reference",
    });

    expect(preview.issues.map((issue) => issue.code)).toEqual([
      "missing_reference_frame",
      "missing_dialogue_audio",
    ]);
    expect(preview.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "dialogue_timing" }),
      ]),
    );
  });
});

function panel() {
  return {
    id: "panel-1",
    storyboardId: "storyboard-1",
    panelIndex: 0,
    linkedToNextPanel: false,
    description: "林玄受创",
    durationSeconds: 4,
    imagePrompt: "林玄嘴角溢出鲜血",
    videoPrompt: "林玄后退一步",
    firstLastFramePrompt: null,
    actingNotesJson: null,
    charactersJson: "[]",
    propsJson: "[]",
    locationName: null,
    imageAsset: null,
  };
}
