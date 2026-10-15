import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), provider: vi.fn(), assets: vi.fn(), frames: vi.fn(), request: vi.fn() }));
vi.mock("./storyboard-prompt-design", () => ({
  resolveStoryboardPromptContext: mocks.context, resolvePromptDesignProvider: mocks.provider,
  serializePanel: (panel: unknown) => panel,
  StoryboardPromptDesignError: class extends Error {},
}));
vi.mock("@/lib/assets/project-store", () => ({ listOwnedProjectMediaAssets: mocks.assets }));
vi.mock("@/lib/providers/local/video-frames", () => ({ sampleVideoFrames: mocks.frames }));
vi.mock("@/lib/llm/openai-structured", () => ({ requestOpenAiStructured: mocks.request }));
vi.mock("@/lib/production-configuration/store", () => ({ resolveProductionConfiguration: vi.fn().mockResolvedValue({ agents: {}, sources: [] }) }));
import { reviewStoryboardVideo } from "./storyboard-video-review";
const input = { userId: "owner", projectId: "project", episodeId: "episode", panelId: "panel", channelId: "channel", model: "vision", locale: "zh" as const };
const review = { summary: "采样帧可见道具漂移", findings: [{ category: "continuity", frameNumbers: [2], observation: "铁盒从双手移到地面", minimalRepair: "保持铁盒在双手承托位置" }], limitations: ["不能验证连续运动或声音"] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ panel: { id: "panel", videoAssetId: "frozen-video", imageAssetId: "frozen-image" }, adjacent: [], assetProfiles: {} });
  mocks.assets.mockImplementation(async (_u, _p, ids) => ids.map((id: string) => ({ id, url: `data:${id}` })));
  mocks.frames.mockResolvedValue({ durationSeconds: 6, frames: [{ frameNumber: 1, second: 0, imageUrl: "sample-1" }, { frameNumber: 2, second: 5.75, imageUrl: "sample-2" }] });
  mocks.provider.mockResolvedValue({ model: "vision", channelId: "channel" });
  mocks.request.mockImplementation(async ({ schema, validate }) => {
    const data = schema.parse(review);
    if (validate(data).length) throw new Error("INVALID_EVIDENCE");
    return { data, outputText: JSON.stringify(data), trace: { model: "vision" } };
  });
});
describe("sampled storyboard video diagnosis", () => {
  it("uses scoped frozen media, maps attachment order and exposes hard coverage limits", async () => {
    const result = await reviewStoryboardVideo(input);
    expect(mocks.assets).toHaveBeenNthCalledWith(1, "owner", "project", ["frozen-video"], ["video"]);
    expect(mocks.frames).toHaveBeenCalledWith("data:frozen-video");
    const request = mocks.request.mock.calls[0][0];
    expect(request.imageUrls).toEqual(["data:frozen-image", "sample-1", "sample-2"]);
    expect(request.prompt.text).toContain('"imageNumber":3');
    expect(request.requireVisionModel).toBe(true);
    expect(result).toMatchObject({ videoAssetId: "frozen-video", coverage: "sampled_frames_only", audio: "not_checked", continuousMotion: "not_checked" });
    expect(request.validate({ ...review, findings: [{ ...review.findings[0], frameNumbers: [6] }] })).toHaveLength(1);
  });
  it("requires an adopted video and does not send a model request on extraction/ownership failure", async () => {
    mocks.context.mockResolvedValueOnce({ panel: {}, adjacent: [] });
    await expect(reviewStoryboardVideo(input)).rejects.toThrow("先采用");
    mocks.assets.mockRejectedValueOnce(new Error("ASSET_FORBIDDEN"));
    await expect(reviewStoryboardVideo(input)).rejects.toThrow("ASSET_FORBIDDEN");
    mocks.frames.mockRejectedValueOnce(new Error("FFMPEG_FAILED"));
    await expect(reviewStoryboardVideo(input)).rejects.toThrow("FFMPEG_FAILED");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
