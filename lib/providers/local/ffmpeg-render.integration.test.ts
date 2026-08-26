import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    "renders mixed video, still image, and audio into one normalized MP4",
    async ({ skip }) => {
      const executable = process.env.FFMPEG_PATH || ffmpegStatic;
      if (!executable || !(await canExecuteFfmpeg(executable))) {
        skip();
        return;
      }
      const root = await mkdtemp(join(tmpdir(), "cyanyi-render-test-"));
      try {
        const videoPath = join(root, "source.mp4");
        const audioPath = join(root, "source.wav");
        await execFileAsync(executable, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=red:s=160x90:d=0.6:r=10",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          videoPath,
        ]);
        await execFileAsync(executable, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:sample_rate=44100:duration=1.2",
          audioPath,
        ]);
        const video = await readFile(videoPath);
        const audio = await readFile(audioPath);
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
          audioUrl: `data:audio/wav;base64,${audio.toString("base64")}`,
        });
        const output = Buffer.from(rendered.dataUrl.split(",")[1], "base64");
        expect(output.byteLength).toBeGreaterThan(1000);
        expect(output.subarray(4, 8).toString("ascii")).toBe("ftyp");
        expect(rendered.specification).toMatchObject({
          width: 256,
          height: 256,
          fps: 10,
          audioSampleRate: 48000,
          audioChannels: 2,
        });
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
