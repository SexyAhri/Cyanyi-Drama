import { describe, expect, it } from "vitest";

import { detectChatMediaToolIntent } from "./route";

describe("detectChatMediaToolIntent", () => {
  const composer = {
    mode: "chat" as const,
    imageModel: "image-model",
    videoModel: "video-model",
  };

  it("recognizes natural image-generation requests", () => {
    expect(
      detectChatMediaToolIntent({
        composer,
        content: "那你先给我随便来一张",
      }),
    ).toEqual({ enableImage: true, enableVideo: false });
  });

  it("recognizes natural video-generation requests", () => {
    expect(
      detectChatMediaToolIntent({
        composer,
        content: "给我来一段视频",
      }),
    ).toEqual({ enableImage: false, enableVideo: true });
  });

  it("does not call a media tool for capability questions", () => {
    expect(
      detectChatMediaToolIntent({
        composer,
        content: "你检查一下本地有没有图片生成工具",
      }),
    ).toEqual({ enableImage: false, enableVideo: false });
  });

  it("does not call a media tool to locate or analyze an existing image", () => {
    expect(
      detectChatMediaToolIntent({
        composer,
        content: "图片在哪，我怎么没有看见",
      }),
    ).toEqual({ enableImage: false, enableVideo: false });
  });
});
