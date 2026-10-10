import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  panelFindFirst: vi.fn(),
  lineFindFirst: vi.fn(),
  lineCount: vi.fn(),
  createProductionTask: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  ensureAnonymousUser: async () => ({ user: { id: "user-1" }, sessionId: null }),
  attachSessionCookie: (response: Response) => response,
}));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    storyboardPanel: { findFirst: mocks.panelFindFirst },
    voiceLine: { findFirst: mocks.lineFindFirst, count: mocks.lineCount },
  },
}));
vi.mock("@/lib/media/production-tasks", () => ({
  createProductionTask: mocks.createProductionTask,
  ProductionTaskError: class ProductionTaskError extends Error {},
}));

import { POST } from "./route";

const context = {
  params: Promise.resolve({ projectId: "project-1", episodeId: "episode-1" }),
};

function request() {
  return new Request("https://example.test/lip-sync", {
    method: "POST",
    body: JSON.stringify({
      channelId: "channel-1",
      model: "lip-model",
      panelId: "panel-1",
      audioAssetId: "audio-1",
      voiceLineId: "line-1",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.panelFindFirst.mockResolvedValue({
    id: "panel-1",
    speakingCharacter: "韩宇",
    lipSyncText: "父亲，你回来了。",
    charactersJson: JSON.stringify(["韩宇", "韩子枫"]),
    videoSegments: [{ id: "segment-1" }],
  });
  mocks.lineFindFirst.mockResolvedValue({
    speaker: "韩宇",
    content: "父亲，你回来了。",
    delivery: "dialogue",
    matchedPanelId: "panel-1",
    audioAssetId: "audio-1",
  });
  mocks.lineCount.mockResolvedValue(1);
  mocks.createProductionTask.mockResolvedValue({ id: "task-1" });
});

describe("lip sync submission", () => {
  it("binds the task to one exact visible speaker and voice line", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(202);
    expect(mocks.createProductionTask).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "panel-1",
        request: expect.objectContaining({
          voiceLineId: "line-1",
          audioAssetId: "audio-1",
        }),
      }),
    );
  });

  it("rejects a voice line assigned to a shot without that speaker", async () => {
    mocks.panelFindFirst.mockResolvedValueOnce({
      id: "panel-1",
      speakingCharacter: "韩子枫",
      lipSyncText: "父亲，你回来了。",
      charactersJson: JSON.stringify(["韩子枫"]),
      videoSegments: [],
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(400);
    expect(mocks.createProductionTask).not.toHaveBeenCalled();
  });

  it("rejects multiple dialogue lines competing for one lip sync output", async () => {
    mocks.lineCount.mockResolvedValueOnce(2);
    const response = await POST(request(), context);
    expect(response.status).toBe(400);
    expect(mocks.createProductionTask).not.toHaveBeenCalled();
  });
});
