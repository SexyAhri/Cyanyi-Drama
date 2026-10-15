import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ owns: vi.fn(), current: vi.fn(), snapshot: vi.fn(), create: vi.fn(), enqueue: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({ prisma: { episode: { count: mocks.owns } } }));
vi.mock("@/lib/production/timeline-source-state", () => ({ assertEpisodeTimelineCurrent: mocks.current }));
vi.mock("@/lib/production/render-snapshot", () => ({ captureTimelineRenderSnapshot: mocks.snapshot }));
vi.mock("./task-store", () => ({ createDatabaseMediaTaskStore: () => ({ create: mocks.create }) }));
vi.mock("./task-submit", () => ({ enqueuePersistedMediaTask: mocks.enqueue }));
import { createLocalRenderTask, isLocalRenderTask } from "./local-render-task";

beforeEach(() => {
  vi.clearAllMocks(); mocks.owns.mockResolvedValue(1); mocks.current.mockResolvedValue(undefined);
  mocks.snapshot.mockResolvedValue({ version: 1, userId: "u", projectId: "p", episodeId: "e", voiceLines: [], editorProject: { timelineJson: JSON.stringify({ duration: 2, tracks: [{ id: "shot", duration: 2, imageFit: "crop" }] }), subtitleJson: JSON.stringify([{ id: "line", index: 0, start: 0.5, end: 1.5, text: "嗯", speaker: "A" }]) } });
  mocks.enqueue.mockImplementation(async (_user, task) => task);
});
describe("local render submission", () => {
  it("queues a fixed local operation without looking up any channel, model or price", async () => {
    const task = await createLocalRenderTask({ userId: "u", projectId: "p", episodeId: "e", specification: { ratio: "16:9", resolution: "720p" } });
    expect(task).toMatchObject({ provider: "local", protocol: "local", model: "local-ffmpeg", targetType: "editor_render", request: { operation: "render_timeline", width: 1280, height: 720, timelineRenderSnapshot: { editorProject: { subtitleJson: expect.stringContaining('"start":0.5') } } } });
    expect(task.channelId).toBeUndefined(); expect(isLocalRenderTask(task, task.request)).toBe(true); expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.enqueue).toHaveBeenCalledOnce();
  });
  it("rejects wrong ownership and changed sources before persisting", async () => {
    mocks.owns.mockResolvedValueOnce(0);
    await expect(createLocalRenderTask({ userId: "u", projectId: "p", episodeId: "e", specification: {} })).rejects.toThrow("不存在");
    mocks.current.mockRejectedValueOnce(new Error("采用素材已变化"));
    await expect(createLocalRenderTask({ userId: "u", projectId: "p", episodeId: "e", specification: {} })).rejects.toThrow("采用素材已变化");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not recognize forged local identity for arbitrary operations", () => {
    expect(isLocalRenderTask({ targetType: "canvas_node", provider: "local", protocol: "local", model: "local-ffmpeg" }, { operation: "render_timeline" })).toBe(false);
  });
  it("does not treat a planned duration as an actual audio asset", async () => {
    const snapshot = await mocks.snapshot();
    snapshot.voiceLines = [{ id: "line", durationSeconds: 0.2, audioAssetId: null }];
    snapshot.editorProject.subtitleJson = JSON.stringify([{ id: "line", index: 0, start: 0.5, end: 0.7, text: "嗯", speaker: "A" }]);
    mocks.snapshot.mockResolvedValue(snapshot);
    await expect(createLocalRenderTask({ userId: "u", projectId: "p", episodeId: "e", specification: {} })).rejects.toThrow("阅读时间不足");
    expect(mocks.create).not.toHaveBeenCalled();
    snapshot.voiceLines[0].audioAssetId = "audio-asset";
    await expect(createLocalRenderTask({ userId: "u", projectId: "p", episodeId: "e", specification: {} })).resolves.toMatchObject({ provider: "local" });
  });
  it("rejects a short silent cue even when a different cue has actual audio", async () => {
    const snapshot = await mocks.snapshot();
    snapshot.voiceLines = [{ id: "audio", audioAssetId: "asset" }, { id: "silent", audioAssetId: null }];
    const cues = [
      { id: "audio", index: 0, start: 0, end: 0.2, text: "嗯", speaker: "A" },
      { id: "silent", index: 1, start: 0.5, end: 0.7, text: "嗯", speaker: "B" },
    ];
    snapshot.editorProject.subtitleJson = JSON.stringify(cues);
    mocks.snapshot.mockResolvedValue(snapshot);
    await expect(createLocalRenderTask({ userId: "u", projectId: "p", episodeId: "e", specification: {} })).rejects.toThrow("阅读时间不足");
    expect(mocks.create).not.toHaveBeenCalled();
    cues[1].end = 1.5;
    snapshot.editorProject.subtitleJson = JSON.stringify(cues);
    await expect(createLocalRenderTask({ userId: "u", projectId: "p", episodeId: "e", specification: {} })).resolves.toMatchObject({ provider: "local" });
  });
});
