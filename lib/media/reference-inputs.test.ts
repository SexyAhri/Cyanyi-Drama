import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  resolveStoredMediaInput: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { mediaAsset: { findMany: mocks.findMany } },
}));
vi.mock("@/lib/storage", () => ({
  resolveStoredMediaInput: mocks.resolveStoredMediaInput,
}));

import { resolveStoredReferenceImages } from "./reference-inputs";

describe("stored media reference inputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes a new task reference by its stable storage key", async () => {
    mocks.findMany.mockResolvedValue([
      {
        url: "http://localhost:9000/old-signed-url",
        storageKey: "projects/project-1/character.png",
        mimeType: "image/png",
      },
    ]);
    mocks.resolveStoredMediaInput.mockResolvedValue(
      "http://localhost:9000/fresh-signed-url",
    );

    await expect(
      resolveStoredReferenceImages(
        {
          referenceImages: [
            {
              url: "http://localhost:9000/expired-signed-url",
              storageKey: "projects/project-1/character.png",
            },
          ],
        },
        "user-1",
      ),
    ).resolves.toEqual({
      referenceImages: [
        {
          url: "http://localhost:9000/fresh-signed-url",
          storageKey: "projects/project-1/character.png",
        },
      ],
    });
    expect(mocks.resolveStoredMediaInput).toHaveBeenCalledWith(
      "projects/project-1/character.png",
      "image/png",
    );
  });

  it("recovers a legacy failed task by matching its expired stored URL", async () => {
    mocks.findMany.mockResolvedValue([
      {
        url: "http://localhost:9000/expired-signed-url",
        storageKey: "projects/project-1/character.png",
        mimeType: "image/png",
      },
    ]);
    mocks.resolveStoredMediaInput.mockResolvedValue(
      "http://localhost:9000/fresh-signed-url",
    );

    const result = await resolveStoredReferenceImages(
      {
        prompt: "shot",
        referenceImages: [
          { url: "http://localhost:9000/expired-signed-url" },
        ],
      },
      "user-1",
    );

    expect(result.referenceImages).toEqual([
      {
        url: "http://localhost:9000/fresh-signed-url",
        storageKey: "projects/project-1/character.png",
      },
    ]);
    expect(result.prompt).toBe("shot");
  });

  it("leaves external references unchanged", async () => {
    mocks.findMany.mockResolvedValue([]);

    await expect(
      resolveStoredReferenceImages(
        { referenceImages: [{ url: "https://cdn.test/reference.png" }] },
        "user-1",
      ),
    ).resolves.toEqual({
      referenceImages: [{ url: "https://cdn.test/reference.png" }],
    });
    expect(mocks.resolveStoredMediaInput).not.toHaveBeenCalled();
  });

  it("fails clearly when a declared stored reference no longer exists", async () => {
    mocks.findMany.mockResolvedValue([]);

    await expect(
      resolveStoredReferenceImages(
        {
          referenceImages: [
            {
              url: "http://localhost:9000/reference.png",
              storageKey: "projects/project-1/missing.png",
            },
          ],
        },
        "user-1",
      ),
    ).rejects.toThrow("REFERENCE_IMAGE_STORAGE_ASSET_NOT_FOUND");
  });
});
