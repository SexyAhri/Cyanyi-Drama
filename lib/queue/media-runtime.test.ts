import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithProviderRetry = vi.hoisted(() => vi.fn());

vi.mock("@/lib/providers/http", () => ({ fetchWithProviderRetry }));

import { generateImage, isSourceMediaDownloadFailure } from "./media-runtime";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("image generation runtime", () => {
  it("falls back to text-to-image when the provider rejects reference editing", async () => {
    fetchWithProviderRetry
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              message:
                "ImageTaskService.submit_edit() got an unexpected keyword argument 'source'",
            },
          },
          { status: 500 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ url: "https://provider.test/shot.png" }] }),
      );

    const result = await generateImage(
      "https://provider.test/v1",
      "openai-compatible",
      "key-1",
      "gpt-image-2",
      {
        prompt: "cinematic shot",
        ratio: "16:9",
        referenceImages: [{ url: "https://provider.test/reference.png" }],
      },
    );

    expect(fetchWithProviderRetry).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchWithProviderRetry.mock.calls[0][1].body)).toMatchObject({
      image: ["https://provider.test/reference.png"],
    });
    expect(JSON.parse(fetchWithProviderRetry.mock.calls[1][1].body)).not.toHaveProperty(
      "image",
    );
    expect(result).toEqual([
      expect.objectContaining({
        url: "https://provider.test/shot.png",
        metadata: { model: "gpt-image-2", referenceFallback: true },
      }),
    ]);
  });

  it("distinguishes broken provider URLs from storage upload failures", () => {
    expect(
      isSourceMediaDownloadFailure(new Error("MEDIA_DOWNLOAD_FAILED:404")),
    ).toBe(true);
    expect(isSourceMediaDownloadFailure(new Error("fetch failed"))).toBe(true);
    expect(
      isSourceMediaDownloadFailure(new Error("S3_BUCKET must be configured.")),
    ).toBe(false);
  });

  it("does not hide unrelated provider failures", async () => {
    fetchWithProviderRetry.mockResolvedValue(
      Response.json({ error: { message: "quota exhausted" } }, { status: 429 }),
    );

    await expect(
      generateImage(
        "https://provider.test/v1",
        "openai-compatible",
        "key-1",
        "gpt-image-2",
        { prompt: "shot", referenceImages: [{ url: "https://ref.test/a.png" }] },
      ),
    ).rejects.toThrow("quota exhausted");
    expect(fetchWithProviderRetry).toHaveBeenCalledTimes(1);
  });
});
