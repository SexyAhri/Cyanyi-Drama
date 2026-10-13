import { describe, expect, it } from "vitest";

import {
  buildAudioMixFilter,
  buildConcatFfmpegArgs,
  buildNormalizeSegmentArgs,
  buildSubtitleSrt,
  buildSubtitleVideoFilter,
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
      true,
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
    expect(image.join(" ")).toContain("zoompan=");
    expect(image.join(" ")).toContain("1.03");
    expect(video.join(" ")).not.toContain("zoompan=");
    const concatArgs = buildConcatFfmpegArgs(
      "inputs.txt",
      "audio.wav",
      "output.mp4",
      specification,
      null,
      [],
      8,
    );
    expect(concatArgs).toEqual(
      expect.arrayContaining([
        "-c:v",
        "copy",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-filter_complex",
        expect.stringContaining("[1:a:0]"),
      ]),
    );
    expect(concatArgs[concatArgs.indexOf("-filter_complex") + 1]).not.toContain(
      "[0:a:0]",
    );
    expect(video).toEqual(expect.arrayContaining(["-map", "0:a:0"]));
    expect(image).toEqual(expect.arrayContaining(["-map", "1:a:0"]));
    expect(video).not.toContain("-an");
  });

  it("mixes source dialogue with supplementary sound tracks", () => {
    const args = buildConcatFfmpegArgs("inputs.txt", null, "output.mp4", normalizeRenderSpecification(), null, [{ path: "music.wav", kind: "music" }], 8);
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("[0:a:0]");
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("[1:a:0]");
  });

  it("mixes independent sound layers and ducks them under dialogue", () => {
    const tracks = [
      { path: "dialogue.wav", kind: "dialogue" as const, volume: 1 },
      {
        path: "ambience.wav",
        kind: "ambience" as const,
        startSeconds: 2,
        endSeconds: 10,
        volume: 0.35,
        loop: true,
      },
      {
        path: "impact.wav",
        kind: "sfx" as const,
        startSeconds: 4.25,
        endSeconds: 5,
        volume: 0.8,
      },
    ];
    const filter = buildAudioMixFilter(tracks, 12);

    expect(filter).toContain("[1:a:0]");
    expect(filter).toContain("[2:a:0]");
    expect(filter).toContain("[3:a:0]");
    expect(filter).toContain("adelay=2000:all=1");
    expect(filter).toContain("adelay=4250:all=1");
    expect(filter).toContain("volume=0.350");
    expect(filter).toContain("volume=0.800");
    expect(filter).toContain("asplit=2");
    expect(filter).toContain("sidechaincompress=");
    expect(filter).toContain("loudnorm=I=-16:LRA=11:TP=-1.5");
    expect(filter).toContain("[premaster]");

    const specification = normalizeRenderSpecification();
    const args = buildConcatFfmpegArgs(
      "inputs.txt",
      null,
      "output.mp4",
      specification,
      null,
      tracks,
      12,
    );
    expect(args).toEqual(
      expect.arrayContaining([
        "-stream_loop",
        "-1",
        "ambience.wav",
        "-map",
        "[mixed]",
        "-t",
        "12.000",
      ]),
    );
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

    const subtitleFilter = buildSubtitleVideoFilter("C:\\Temp\\subtitles.srt");
    expect(subtitleFilter).toContain("FontSize=16");
    expect(subtitleFilter).toContain("MarginV=16");

    const args = buildConcatFfmpegArgs(
      "inputs.txt",
      "audio.wav",
      "output.mp4",
      specification,
      "C:\\Temp\\subtitles.srt",
      [],
      3,
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
