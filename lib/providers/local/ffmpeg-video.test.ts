import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegStatic from "ffmpeg-static";
import { describe, expect, it } from "vitest";

import { buildStripAudioArgs, stripAudioFromVideoUrl } from "./ffmpeg-video";

const execFileAsync = promisify(execFile);

describe("FFmpeg video audio policy", () => {
  it("copies the video stream without encoding and removes every audio stream", () => {
    const args = buildStripAudioArgs("input.mp4", "output.mp4");

    expect(args).toContain("-an");
    expect(args).toContain("0:v:0");
    expect(args).toContain("copy");
    expect(args).not.toContain("-c:a");
    expect(args.at(-1)).toBe("output.mp4");
  });

  it(
    "keeps the video stream and removes the native audio stream",
    async ({ skip }) => {
      const executable = process.env.FFMPEG_PATH || ffmpegStatic;
      if (!executable || !(await canExecuteFfmpeg(executable))) {
        skip();
        return;
      }
      const root = await mkdtemp(join(tmpdir(), "cyanyi-strip-test-"));
      try {
        const sourcePath = join(root, "source.mp4");
        const strippedPath = join(root, "stripped.mp4");
        await execFileAsync(executable, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=160x90:d=0.5:r=10",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:sample_rate=44100:duration=0.5",
          "-shortest",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          sourcePath,
        ]);
        const source = await readFile(sourcePath);
        const stripped = await stripAudioFromVideoUrl(
          `data:video/mp4;base64,${source.toString("base64")}`,
        );
        await writeFile(strippedPath, stripped);

        await expect(
          mapStream(executable, strippedPath, "0:v:0"),
        ).resolves.toBeUndefined();
        await expect(
          mapStream(executable, strippedPath, "0:a:0"),
        ).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

async function mapStream(executable: string, path: string, stream: string) {
  await execFileAsync(executable, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    path,
    "-map",
    stream,
    "-f",
    "null",
    "-",
  ]);
}

async function canExecuteFfmpeg(executable: string) {
  try {
    await execFileAsync(executable, ["-version"]);
    return true;
  } catch {
    return false;
  }
}
