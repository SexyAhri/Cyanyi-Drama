import { describe, expect, it } from "vitest";

import {
  buildConcatFfmpegArgs,
  buildNormalizeSegmentArgs,
  buildSubtitleSrt,
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
      {
        url: "https://example.com/a.webm",
        panelIndex: 0,
        kind: "video",
        durationSeconds: 4,
        sourceStartSeconds: 1.25,
        transition: "fade",
        transitionDurationSeconds: 0.5,
        volume: 0.75,
      },
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
    expect(video).toEqual(expect.arrayContaining(["-ss", "1.25"]));
    expect(video.join(" ")).toContain("fade=t=in:st=0:d=0.5");
    expect(video.join(" ")).toContain("volume=0.75");
    expect(video.join(" ")).toContain("afade=t=out:st=3.5:d=0.5");
    expect(image).toEqual(expect.arrayContaining(["-loop", "1", "-t", "4"]));
    expect(image.join(" ")).toContain("anullsrc");
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
        "-filter_complex",
        "[0:a:0][1:a:0]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=300[ducked];[ducked][1:a:0]amix=inputs=2:duration=first:dropout_transition=0:weights=0.8 1:normalize=0[mixed]",
      ]),
    );
    expect(video).toEqual(expect.arrayContaining(["-map", "0:a:0"]));
    expect(video).not.toContain("-an");
  });

  it("encodes safe SRT cues and transcodes video when burning subtitles", () => {
    const specification = normalizeRenderSpecification({
      resolution: "720p",
      aspectRatio: "16:9",
      fps: 24,
    });
    const srt = buildSubtitleSrt(
      [
        { start: 0, end: 1.25, text: "第一句" },
        { start: 1.25, end: 3, text: "Second <unsafe> line" },
      ],
      specification,
    );
    expect(srt).toContain("00:00:00,000 --> 00:00:01,250");
    expect(srt).toContain("Second unsafe line");

    const args = buildConcatFfmpegArgs(
      "inputs.txt",
      "audio.wav",
      "output.mp4",
      specification,
      "C:\\Temp\\subtitles.srt",
    );
    expect(args).toEqual(
      expect.arrayContaining([
        "-vf",
        expect.stringContaining("subtitles="),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
      ]),
    );
    expect(args).not.toEqual(expect.arrayContaining(["-c:v", "copy"]));
  });
});
