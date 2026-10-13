import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegStatic from "ffmpeg-static";
import { describe, expect, it } from "vitest";

import { renderTimelineVideo } from "./ffmpeg-render";
import { normalizeRenderSpecification } from "./render-spec";

const execFileAsync = promisify(execFile);
const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("ffmpeg timeline render", () => {
  it(
    "preserves native source audio, supports replacement dialogue and mixes independent layers",
    async ({ skip }) => {
      const executable = process.env.FFMPEG_PATH || ffmpegStatic;
      if (!executable || !(await canExecuteFfmpeg(executable))) {
        skip();
        return;
      }
      const root = await mkdtemp(join(tmpdir(), "cyanyi-render-test-"));
      try {
        const videoPath = join(root, "source.mp4");
        const dialoguePath = join(root, "dialogue.wav");
        const ambiencePath = join(root, "ambience.wav");
        const sfxPath = join(root, "sfx.wav");
        await execFileAsync(executable, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=red:s=160x90:d=0.6:r=10",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=1300:sample_rate=48000:duration=0.6",
          "-shortest",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          videoPath,
        ]);
        await Promise.all([
          createTone(executable, dialoguePath, 440, 1.2),
          createTone(executable, ambiencePath, 220, 0.35),
          createTone(executable, sfxPath, 880, 0.2),
        ]);
        const video = await readFile(videoPath);
        const dialogue = await readFile(dialoguePath);
        const ambience = await readFile(ambiencePath);
        const sfx = await readFile(sfxPath);
        const specification = normalizeRenderSpecification({
          width: 256,
          height: 256,
          fps: 10,
          imageDurationSeconds: 0.6,
        });
        const rendered = await renderTimelineVideo({
          specification,
          segments: [
            {
              url: `data:video/mp4;base64,${video.toString("base64")}`,
              panelIndex: 0,
              kind: "video",
              durationSeconds: 0.6,
            },
            {
              url: `data:image/png;base64,${ONE_PIXEL_PNG}`,
              panelIndex: 1,
              kind: "image",
              durationSeconds: 0.6,
            },
          ],
          audioTracks: [
            {
              url: `data:audio/wav;base64,${dialogue.toString("base64")}`,
              kind: "dialogue",
              volume: 0.8,
            },
            {
              url: `data:audio/wav;base64,${ambience.toString("base64")}`,
              kind: "ambience",
              endSeconds: 1.2,
              volume: 0.2,
              loop: true,
            },
            {
              url: `data:audio/wav;base64,${sfx.toString("base64")}`,
              kind: "sfx",
              startSeconds: 0.75,
              endSeconds: 0.95,
              volume: 0.5,
            },
          ],
          subtitles: [
            { start: 0.1, end: 1, text: "Subtitle render check" },
          ],
        });
        const output = Buffer.from(rendered.dataUrl.split(",")[1], "base64");
        const outputPath = join(root, "mixed.mp4");
        await writeFile(outputPath, output);
        expect(output.byteLength).toBeGreaterThan(1000);
        expect(output.subarray(4, 8).toString("ascii")).toBe("ftyp");
        expect(rendered.specification).toMatchObject({
          width: 256,
          height: 256,
          fps: 10,
          audioSampleRate: 48000,
          audioChannels: 2,
        });
        expect(await detectMaxVolume(executable, outputPath)).toBeGreaterThan(
          -60,
        );

        const nativeRender = await renderTimelineVideo({
          specification,
          segments: [
            {
              url: `data:video/mp4;base64,${video.toString("base64")}`,
              panelIndex: 0,
              kind: "video",
              durationSeconds: 0.6,
            },
          ],
        });
        const nativeOutputPath = join(root, "source-audio-preserved.mp4");
        await writeFile(
          nativeOutputPath,
          Buffer.from(nativeRender.dataUrl.split(",")[1], "base64"),
        );
        expect(await detectMaxVolume(executable, nativeOutputPath)).toBeGreaterThan(
          -60,
        );
        expect(nativeRender.hasAudio).toBe(true);

        const silentPath = join(root, "silent-source.mp4");
        await execFileAsync(executable, ["-hide_banner", "-loglevel", "error", "-y", "-i", videoPath, "-map", "0:v:0", "-c:v", "copy", "-an", silentPath]);
        const silentUrl = `data:video/mp4;base64,${(await readFile(silentPath)).toString("base64")}`;
        const silentSegment = { url: silentUrl, panelIndex: 0, kind: "video" as const, durationSeconds: 0.6 };
        const silentRender = await renderTimelineVideo({ specification, segments: [silentSegment] });
        expect(silentRender.hasAudio).toBe(false);
        await expect(renderTimelineVideo({ specification, segments: [{ ...silentSegment, requiresAudio: true }] })).rejects.toThrow("TIMELINE_RENDER_SOURCE_AUDIO_MISSING:0");

        const supplemented = await renderTimelineVideo({
          specification,
          segments: [silentSegment, { url: `data:video/mp4;base64,${video.toString("base64")}`, panelIndex: 1, kind: "video", durationSeconds: 0.6 }],
          audioTracks: [{ url: `data:audio/wav;base64,${ambience.toString("base64")}`, kind: "music", volume: 0 }],
        });
        const supplementedPath = join(root, "native-with-supplementary-track.mp4");
        await writeFile(supplementedPath, Buffer.from(supplemented.dataUrl.split(",")[1], "base64"));
        expect(await detectMaxVolume(executable, supplementedPath)).toBeGreaterThan(-60);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

async function canExecuteFfmpeg(executable: string) {
  try {
    await execFileAsync(executable, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

async function createTone(
  executable: string,
  outputPath: string,
  frequency: number,
  duration: number,
) {
  await execFileAsync(executable, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
    outputPath,
  ]);
}

async function detectMaxVolume(executable: string, inputPath: string) {
  const result = await execFileAsync(executable, [
    "-hide_banner",
    "-i",
    inputPath,
    "-map",
    "0:a:0",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const match = result.stderr.match(/max_volume:\s*(-?(?:inf|\d+(?:\.\d+)?)) dB/i);
  if (!match) throw new Error("FFMPEG_VOLUME_NOT_FOUND");
  return match[1].toLowerCase() === "-inf" ? -Infinity : Number(match[1]);
}
