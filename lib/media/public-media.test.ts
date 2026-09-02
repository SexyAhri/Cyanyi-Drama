import { describe, expect, it } from "vitest";

import {
  compactMediaTaskOutput,
  compactMediaTaskRequest,
  decodeInlineMediaUrl,
  mediaAssetContentUrl,
} from "./public-media";

describe("public media references", () => {
  it("builds a same-origin content URL", () => {
    expect(mediaAssetContentUrl("asset/1")).toBe(
      "/api/media/assets/asset%2F1/content",
    );
  });

  it("removes inline reference copies when a storage key exists", () => {
    expect(
      compactMediaTaskRequest({
        prompt: "frame",
        referenceImages: [
          {
            url: "data:image/png;base64,AQID",
            storageKey: "projects/p1/image.png",
            mimeType: "image/png",
          },
          { url: "https://provider.test/reference.png" },
        ],
      }),
    ).toEqual({
      prompt: "frame",
      referenceImages: [
        {
          url: "stored:projects/p1/image.png",
          storageKey: "projects/p1/image.png",
          mimeType: "image/png",
        },
        { url: "https://provider.test/reference.png" },
      ],
    });
  });

  it("stores small task output links instead of generated media bytes", () => {
    expect(
      compactMediaTaskOutput([
        {
          id: "asset-1",
          kind: "image",
          url: "data:image/png;base64,AQID",
          thumbnailUrl: "data:image/png;base64,AQID",
        },
      ]),
    ).toEqual([
      {
        id: "asset-1",
        kind: "image",
        url: "/api/media/assets/asset-1/content",
        thumbnailUrl: undefined,
      },
    ]);
  });

  it("decodes a legacy inline media URL", () => {
    expect(decodeInlineMediaUrl("data:image/png;base64,AQID")).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });
    expect(decodeInlineMediaUrl("https://media.test/image.png")).toBeNull();
  });
});
