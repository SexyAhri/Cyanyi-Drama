import { afterEach, describe, expect, it, vi } from "vitest";

import {
  localReferencesAsDataUrls,
  providerErrorMessage,
  resolveImageSize,
} from "./shared";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("media references", () => {
  it("keeps database data URLs unchanged", async () => {
    const [result] = await localReferencesAsDataUrls([
      { url: "data:image/png;base64,AQID" },
    ]);

    expect(result).toBe("data:image/png;base64,AQID");
  });

  it("downloads loopback references as data URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        }),
      ),
    );

    await expect(
      localReferencesAsDataUrls([{ url: "http://localhost:3000/shot.png" }]),
    ).resolves.toEqual(["data:image/png;base64,AQID"]);
  });

  it("keeps external provider URLs unchanged", async () => {
    await expect(
      localReferencesAsDataUrls([{ url: "https://media.test/shot.png" }]),
    ).resolves.toEqual(["https://media.test/shot.png"]);
  });
});

describe("provider errors", () => {
  it("falls back to the HTTP status when the provider message is empty", () => {
    expect(providerErrorMessage({ error: { message: "" } }, 404)).toBe(
      "Provider request failed (404).",
    );
  });
});

describe("resolveImageSize", () => {
  it("keeps 1k widescreen output above the provider pixel minimum", () => {
    expect(resolveImageSize("16:9", "1k")).toBe("1080x608");
    expect(resolveImageSize("9:16", "1k")).toBe("608x1080");
  });

  it("keeps 4k widescreen output within the provider pixel maximum", () => {
    expect(resolveImageSize("16:9", "4k")).toBe("3840x2160");
    expect(resolveImageSize("9:16", "4k")).toBe("2160x3840");
  });

  it("preserves sizes that already satisfy the provider limits", () => {
    expect(resolveImageSize("1:1", "2k")).toBe("2048x2048");
    expect(resolveImageSize("4:3", "1k")).toBe("1024x768");
  });

  it("passes through an explicit pixel size", () => {
    expect(resolveImageSize("1280x720", "1k")).toBe("1280x720");
  });
});
