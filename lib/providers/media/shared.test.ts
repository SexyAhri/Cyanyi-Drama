import { afterEach, describe, expect, it, vi } from "vitest";

import { localReferencesAsDataUrls, providerErrorMessage } from "./shared";

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
