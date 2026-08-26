import { describe, expect, it } from "vitest";

import {
  buildConcatFfmpegArgs,
  buildNormalizeSegmentArgs,
} from "./ffmpeg-render";
import { normalizeRenderSpecification } from "./render-spec";

describe("render specification", () => {
  it("normalizes landscape, portrait, and explicit dimensions", () => {
    expect(normalizeRenderSpecification()).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 24,
      pixelFormat: "yuv420p",
    });
    expect(
      normalizeRenderSpecification({ resolution: "720p", aspectRatio: "9:16" }),
    ).toMatchObject({ width: 720, height: 1280 });
    expect(normalizeRenderSpecification({ width: 1001, height: 777 })).toMatchObject({
      width: 1002,
      height: 778,
    });
  });

  it("rejects output specifications that cannot be rendered consistently", () => {
    expect(() => normalizeRenderSpecification({ format: "webm" })).toThrow(
      "RENDER_FORMAT_UNSUPPORTED:webm",
    );
    expect(() => normalizeRenderSpecification({ width: 1920 })).toThrow(
      "RENDER_DIMENSIONS_INCOMPLETE",
    );
    expect(() => normalizeRenderSpecification({ fps: 120 })).toThrow(
      "RENDER_FPS_INVALID",
    );
  });

  it("transcodes video and still images to one concat-safe profile", () => {
    const specification = normalizeRenderSpecification({
      resolution: "720p",
      aspectRatio: "16:9",
      fps: 25,
    });
    const video = buildNormalizeSegmentArgs(
      "input.webm",
      "output.mp4",
      { url: "https://example.com/a.webm", panelIndex: 0, kind: "video" },
      specification,
    );
    const image = buildNormalizeSegmentArgs(
      "input.png",
      "output.mp4",
      {
        url: "https://example.com/a.png",
        panelIndex: 1,
        kind: "image",
        durationSeconds: 4,
      },
      specification,
    );
    expect(video.join(" ")).toContain("scale=1280:720");
    expect(video.join(" ")).toContain("fps=25");
    expect(image).toEqual(expect.arrayContaining(["-loop", "1", "-t", "4"]));
    expect(
      buildConcatFfmpegArgs("inputs.txt", "audio.wav", "output.mp4", specification),
    ).toEqual(
      expect.arrayContaining([
        "-c:v",
        "copy",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-af",
        "apad",
      ]),
    );
  });
});
