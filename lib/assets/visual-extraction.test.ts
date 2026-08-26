import { beforeEach, describe, expect, it, vi } from "vitest";

const listOwnedProjectMediaAssets = vi.hoisted(() => vi.fn());
const requestOpenAiStructured = vi.hoisted(() => vi.fn());
const channelFindFirst = vi.hoisted(() => vi.fn());
const providerModelFindFirst = vi.hoisted(() => vi.fn());

vi.mock("./project-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("./project-store")>();
  return {
    ...original,
    listOwnedProjectMediaAssets,
    linkSourceAssets: vi.fn(),
  };
});

vi.mock("@/lib/llm/openai-structured", () => ({
  requestOpenAiStructured,
}));

vi.mock("@/lib/server/crypto", () => ({
  decryptSecret: () => '["test-key"]',
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    channel: { findFirst: channelFindFirst },
    providerModel: { findFirst: providerModelFindFirst },
    novelCharacter: { findFirst: vi.fn() },
    characterAppearance: { count: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/novel/domain-store", () => ({
  upsertNovelCharacters: vi.fn(),
  upsertNovelLocations: vi.fn(),
}));

vi.mock("@/lib/production/domain-store", () => ({
  upsertProductionProps: vi.fn(),
}));

import { extractProjectVisualAssets } from "./visual-extraction";

beforeEach(() => {
  vi.clearAllMocks();
  listOwnedProjectMediaAssets.mockResolvedValue([
    {
      id: "image-1",
      kind: "image",
      url: "https://media.test/image.png",
      storageKey: null,
      mimeType: "image/png",
      metadataJson: null,
    },
    {
      id: "video-1",
      kind: "video",
      url: "https://media.test/video.mp4",
      storageKey: null,
      mimeType: "video/mp4",
      metadataJson: null,
    },
  ]);
  channelFindFirst.mockResolvedValue({
    baseUrl: "https://provider.test/v1",
    protocol: "openai-compatible",
    encryptedApiKeys: "encrypted",
  });
  providerModelFindFirst.mockResolvedValue({
    capabilitiesJson: JSON.stringify({
      supportsReferenceImages: true,
      supportsStructuredOutputs: false,
    }),
  });
  requestOpenAiStructured.mockResolvedValue({
    data: { characters: [], locations: [], props: [] },
    trace: { promptId: "asset_visual_extraction" },
  });
});

describe("visual asset extraction", () => {
  it("sends owned images and sampled video frames through one vision request", async () => {
    const extractFrames = vi.fn().mockResolvedValue([
      "data:image/jpeg;base64,frame-a",
      "data:image/jpeg;base64,frame-b",
    ]);

    const result = await extractProjectVisualAssets(
      {
        userId: "user-1",
        projectId: "project-1",
        assetIds: ["image-1", "video-1"],
        channelId: "channel-1",
        model: "vision-model",
      },
      { extractFrames },
    );

    expect(extractFrames).toHaveBeenCalledWith(
      "https://media.test/video.mp4",
      3,
    );
    expect(requestOpenAiStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrls: [
          "https://media.test/image.png",
          "data:image/jpeg;base64,frame-a",
          "data:image/jpeg;base64,frame-b",
        ],
      }),
    );
    expect(result.sourceAssetIds).toEqual(["image-1", "video-1"]);
    expect(result.sampledReferenceCount).toBe(3);
  });

  it("requires explicit image-input capability", async () => {
    listOwnedProjectMediaAssets.mockResolvedValue([
      {
        id: "image-1",
        kind: "image",
        url: "https://media.test/image.png",
        storageKey: null,
        mimeType: "image/png",
        metadataJson: null,
      },
    ]);
    providerModelFindFirst.mockResolvedValue({
      capabilitiesJson: JSON.stringify({ supportsReferenceImages: false }),
    });

    await expect(
      extractProjectVisualAssets(
        {
          userId: "user-1",
          projectId: "project-1",
          assetIds: ["image-1"],
          channelId: "channel-1",
          model: "text-only-model",
        },
        { extractFrames: vi.fn() },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(requestOpenAiStructured).not.toHaveBeenCalled();
  });
});
