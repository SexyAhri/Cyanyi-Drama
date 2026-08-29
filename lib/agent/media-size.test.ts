import { describe, expect, it } from "vitest";

import { getOpenAICompatibleImageSizeCandidates } from "./media-size";

describe("getOpenAICompatibleImageSizeCandidates", () => {
  it("maps the 1K image preset to provider dimensions", () => {
    expect(getOpenAICompatibleImageSizeCandidates("1k", "1:1")[0]).toEqual({
      height: 1024,
      size: "1024x1024",
      width: 1024,
    });
    expect(getOpenAICompatibleImageSizeCandidates("1k", "16:9")[0]).toEqual({
      height: 768,
      size: "1360x768",
      width: 1360,
    });
  });

  it("uses dimensions divisible by 16 for the 1080p preset", () => {
    const sizes = [
      getOpenAICompatibleImageSizeCandidates("1080p", "1:1")[0],
      getOpenAICompatibleImageSizeCandidates("1080p", "16:9")[0],
      getOpenAICompatibleImageSizeCandidates("1080p", "9:16")[0],
    ];

    expect(sizes).toEqual([
      { height: 1072, size: "1072x1072", width: 1072 },
      { height: 1072, size: "1904x1072", width: 1904 },
      { height: 1904, size: "1072x1904", width: 1072 },
    ]);
  });

  it("matches the low-quality 16:9 size used by infinite canvas", () => {
    expect(getOpenAICompatibleImageSizeCandidates("720p", "16:9")[0]).toEqual({
      height: 768,
      size: "1360x768",
      width: 1360,
    });
  });

  it("preserves the selected 16:9 ratio at 4K", () => {
    expect(getOpenAICompatibleImageSizeCandidates("4k", "16:9")[0]).toEqual({
      height: 2160,
      size: "3840x2160",
      width: 3840,
    });
  });

  it("accepts a full-width colon without flipping the ratio", () => {
    expect(getOpenAICompatibleImageSizeCandidates("4k", "16：9")[0]).toEqual({
      height: 2160,
      size: "3840x2160",
      width: 3840,
    });
  });

  it("keeps portrait ratios portrait at 4K", () => {
    expect(getOpenAICompatibleImageSizeCandidates("4k", "9:16")[0]).toEqual({
      height: 3840,
      size: "2160x3840",
      width: 2160,
    });
  });

  it("uses only the selected size without fallback retries", () => {
    expect(getOpenAICompatibleImageSizeCandidates("4k", "16:9")).toEqual([
      {
        height: 2160,
        size: "3840x2160",
        width: 3840,
      },
    ]);
  });
});
