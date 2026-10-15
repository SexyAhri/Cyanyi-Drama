import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { sampleVideoFrames, videoSampleTimes } from "./video-frames";

describe("whole-clip video review sampling", () => {
  it("covers the beginning, middle and end, with bounded finite counts", () => {
    expect(videoSampleTimes(20, 5)).toEqual([0, 4.9375, 9.875, 14.8125, 19.75]);
    expect(videoSampleTimes(0.1, 100)).toHaveLength(6);
    for (const duration of [0, -1, NaN, Infinity, 601]) expect(() => videoSampleTimes(duration)).toThrow();
    expect(() => videoSampleTimes(1, NaN)).toThrow();
  });
  it("extracts actual JPEGs from both halves of a local synthetic video", async () => {
    const executable = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
    const root = await mkdtemp(join(tmpdir(), "cyanyi-sample-test-"));
    try {
      const file = join(root, "fixture.mp4");
      await promisify(execFile)(executable, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=160x90:d=2:r=10",
        "-f", "lavfi", "-i", "color=c=blue:s=160x90:d=2:r=10", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-c:v", "libx264", "-pix_fmt", "yuv420p", file], { windowsHide: true });
      const bytes = await readFile(file);
      const result = await sampleVideoFrames(`data:video/mp4;base64,${bytes.toString("base64")}`);
      expect(result.durationSeconds).toBeCloseTo(4, 1);
      expect(result.frames).toHaveLength(5);
      expect(result.frames.at(-1)!.second).toBeGreaterThan(3);
      expect(result.frames[0].imageUrl).not.toBe(result.frames.at(-1)!.imageUrl);
      for (const frame of result.frames) expect(Buffer.from(frame.imageUrl.split(",")[1], "base64").subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      await expect(sampleVideoFrames("data:video/mp4;base64,AA==")).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);
});
