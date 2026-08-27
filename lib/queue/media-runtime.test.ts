import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithProviderRetry = vi.hoisted(() => vi.fn());

vi.mock("@/lib/providers/http", () => ({ fetchWithProviderRetry }));

import { generateImage, isSourceMediaDownloadFailure } from "./media-runtime";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("image generation runtime", () => {
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
        {
          prompt: "shot",
          referenceImages: [{ url: "data:image/png;base64,AQID" }],
        },
      ),
    ).rejects.toThrow("quota exhausted");
    expect(fetchWithProviderRetry).toHaveBeenCalledTimes(1);
  });
});
