import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findLine: vi.fn(),
  updateLine: vi.fn(),
  clearPanel: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    voiceLine: { findFirst: mocks.findLine },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      voiceLine: { update: mocks.updateLine },
      storyboardPanel: { updateMany: mocks.clearPanel },
    }),
  },
}));

import { updateVoiceLine } from "./domain-store";

const oldLine = {
  id: "line-1",
  episodeId: "episode-1",
  lineIndex: 0,
  speaker: "韩宇",
  content: "父亲，你回来了。",
  delivery: "dialogue",
  matchedPanelId: "panel-1",
  voicePresetId: null,
  voiceProfilePrompt: null,
  emotionPrompt: null,
  emotionStrength: 0.5,
  optimizeInstructions: true,
  audioAssetId: "audio-old",
  durationSeconds: 3,
  status: "generated",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findLine.mockResolvedValue(oldLine);
  mocks.updateLine.mockImplementation(async ({ data }) => ({ ...oldLine, ...data }));
  mocks.clearPanel.mockResolvedValue({ count: 1 });
});

describe("voice line changes", () => {
  it("clears old audio and lip sync when spoken text changes", async () => {
    await updateVoiceLine("user-1", "project-1", "episode-1", "line-1", {
      content: "父亲，你终于回来了。",
    });
    expect(mocks.updateLine).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        audioAssetId: null,
        durationSeconds: null,
        status: "draft",
      }),
    }));
    expect(mocks.clearPanel).toHaveBeenCalledWith(expect.objectContaining({
      data: { lipSyncAssetId: null },
    }));
  });

  it("keeps existing media when saved text is unchanged", async () => {
    await updateVoiceLine("user-1", "project-1", "episode-1", "line-1", {
      content: oldLine.content,
    });
    expect(mocks.updateLine.mock.calls[0][0].data).not.toHaveProperty("audioAssetId");
    expect(mocks.clearPanel).not.toHaveBeenCalled();
  });
});
