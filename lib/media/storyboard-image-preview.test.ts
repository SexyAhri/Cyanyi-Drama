import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ panel: vi.fn(), characters: vi.fn(), create: vi.fn(), queue: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({ prisma: {
  channel: { findFirst: vi.fn(async () => ({ id: "channel", protocol: "openai-compatible", providerKey: "test" })) },
  providerModel: { count: vi.fn(async () => 1) },
  storyboardPanel: { findFirst: mocks.panel },
  novelCharacter: { findMany: mocks.characters },
  projectConfig: { findUnique: vi.fn(async () => ({ artStyle: "realistic" })) },
} }));
vi.mock("@/lib/media/task-store", () => ({ createDatabaseMediaTaskStore: () => ({ create: mocks.create }) }));
vi.mock("@/lib/media/task-submit", () => ({ enqueuePersistedMediaTask: mocks.queue }));
vi.mock("@/lib/assets/story-world", () => ({ getStoryWorldDirective: () => "既定故事世界", loadProjectAssetStoryWorldContext: async () => ({ lock: {} }) }));
vi.mock("@/lib/production-configuration/execution", async importOriginal => ({ ...(await importOriginal<typeof import("@/lib/production-configuration/execution")>()), resolveProductionRequestConfiguration: mocks.config }));

import { createStoryboardPanelImageTask, previewStoryboardPanelPrompt } from "./project-asset-tasks";
import { DEFAULT_RUNTIME_SETTINGS } from "@/lib/settings/runtime-contract";
import { mergeProductionConfigurations } from "@/lib/production-configuration/contract";
const input = { userId: "owner", projectId: "project", episodeId: "episode", panelId: "panel", model: "image", channelId: "channel", mediaDefaults: { ...DEFAULT_RUNTIME_SETTINGS } };
const reference = (id: string) => ({ id, url: `https://test/${id}`, storageKey: `test/${id}`, mimeType: "image/png" });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.panel.mockResolvedValue({ id: "panel", description: "A waits", imagePrompt: "Two people", charactersJson: '["A"]', propsJson: "[]", locationName: null, storyboard: { status: "ready", episode: { novelText: "A waits" } } });
  mocks.characters.mockResolvedValue([{ name: "A", visualProfileJson: null, appearances: [{ imageAsset: reference("adopted-a") }] }]);
  mocks.config.mockResolvedValue({ ...mergeProductionConfigurations([]), format: "production-configuration-v1", sources: [] });
  mocks.queue.mockImplementation(async (_user, task) => task);
});

describe("image preview submission contract", () => {
  it("returns complete image parameters/references and submits the unchanged approved request", async () => {
    const preview = await previewStoryboardPanelPrompt({ ...input, kind: "image" });
    expect(preview.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.references).toEqual([expect.objectContaining({ assetId: "adopted-a" })]);
    expect(preview.parameters).toMatchObject({ count: 1, quality: "high", ratio: "16:9", resolution: "1k", format: "png" });
    const { task } = await createStoryboardPanelImageTask({ ...input, previewRequestHash: preview.requestHash, previewConfigurationHash: preview.configurationHash });
    expect(task.request.referenceImages).toEqual(preview.references);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const frozen = JSON.stringify(task.request);
    mocks.characters.mockResolvedValue([{ name: "A", visualProfileJson: null, appearances: [{ imageAsset: reference("adopted-b") }] }]);
    await previewStoryboardPanelPrompt({ ...input, kind: "image" });
    expect(JSON.stringify(task.request)).toBe(frozen);
  });
  it("rejects changed adopted references before creating or queueing a task", async () => {
    const preview = await previewStoryboardPanelPrompt({ ...input, kind: "image" });
    mocks.characters.mockResolvedValue([{ name: "A", visualProfileJson: null, appearances: [{ imageAsset: reference("adopted-b") }] }]);
    await expect(createStoryboardPanelImageTask({ ...input, previewRequestHash: preview.requestHash })).rejects.toThrow("重新预览");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled();
  });
  it.each([{ imageGenerationCount: 2 }, { imageGenerationQuality: "auto" }, { imageGenerationResolution: "2k" }, { videoGenerationRatio: "1:1" }] as const)("rejects changed default image parameters %j before persistence", async changed => {
    const preview = await previewStoryboardPanelPrompt({ ...input, kind: "image" });
    await expect(createStoryboardPanelImageTask({ ...input, mediaDefaults: { ...input.mediaDefaults, ...changed }, previewRequestHash: preview.requestHash })).rejects.toThrow("重新预览");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled();
  });
});
