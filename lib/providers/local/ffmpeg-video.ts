import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);

export async function stripAudioFromVideoUrl(url: string) {
  const root = await mkdtemp(join(tmpdir(), "cyanyi-video-strip-"));
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok)
      throw new Error(`VIDEO_AUDIO_STRIP_DOWNLOAD_FAILED:${response.status}`);
    const inputPath = join(root, "input.mp4");
    const outputPath = join(root, "output.mp4");
    await writeFile(inputPath, Buffer.from(await response.arrayBuffer()));
    try {
      await execFileAsync(
        resolveFfmpegExecutable(),
        buildStripAudioArgs(inputPath, outputPath),
        { timeout: 10 * 60_000, windowsHide: true },
      );
    } catch (error) {
      if (isMissingExecutable(error))
        throw new Error(
          "FFMPEG_NOT_FOUND: 项目依赖未提供可用 FFmpeg，请重新安装依赖或配置 FFMPEG_PATH",
        );
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `VIDEO_AUDIO_STRIP_FFMPEG_FAILED:${message.slice(0, 500)}`,
      );
    }
    return new Uint8Array(await readFile(outputPath));
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function buildStripAudioArgs(inputPath: string, outputPath: string) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-c:v",
    "copy",
    "-an",
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

function resolveFfmpegExecutable() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (ffmpegStatic) {
    try {
      if (statSync(ffmpegStatic).size > 0) return ffmpegStatic;
    } catch {
      // Fall back to PATH so a system installation still works.
    }
  }
  return "ffmpeg";
}

function isMissingExecutable(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["ENOENT", "EFTYPE", "EINVAL"].includes(
    String((error as { code?: unknown }).code),
  );
}
