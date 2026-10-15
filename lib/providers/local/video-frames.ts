import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegStatic from "ffmpeg-static";
import { parseVideoInspection } from "./ffmpeg-video";

const execFileAsync = promisify(execFile);

export function videoSampleTimes(durationSeconds: number, count = 5) {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > 600
  )
    throw new Error(
      "VIDEO_REVIEW_DURATION_INVALID: 仅支持不超过 10 分钟的视频片段",
    );
  if (!Number.isFinite(count)) throw new Error("VIDEO_FRAME_COUNT_INVALID");
  const size = Math.min(6, Math.max(2, Math.floor(count)));
  const end = Math.max(
    0,
    durationSeconds - Math.min(0.25, durationSeconds / 10),
  );
  return Array.from({ length: size }, (_, index) =>
    Number(((end * index) / (size - 1)).toFixed(4)),
  );
}

/** Whole-clip sampling, separate from the legacy first-few-seconds extractor. */
export async function sampleVideoFrames(url: string, count = 5) {
  const root = await mkdtemp(join(tmpdir(), "cyanyi-video-review-"));
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok || !response.body)
      throw new Error(`VIDEO_FRAME_DOWNLOAD_FAILED:${response.status}`);
    const maxBytes = 100 * 1024 * 1024;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes)
          throw new Error("VIDEO_REVIEW_TOO_LARGE: 视频不能超过 100 MB");
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const inputPath = join(root, "input.video");
    await writeFile(inputPath, Buffer.concat(chunks));
    let diagnostic = "";
    try {
      diagnostic = (
        await execFileAsync(
          resolveFfmpegExecutable(),
          ["-hide_banner", "-i", inputPath],
          { timeout: 30_000, windowsHide: true },
        )
      ).stderr;
    } catch (error) {
      if (!error || typeof error !== "object" || !("stderr" in error))
        throw error;
      diagnostic = String(error.stderr);
    }
    const { durationSeconds } = parseVideoInspection(diagnostic);
    const times = videoSampleTimes(durationSeconds, count);
    const frames = [];
    for (const [index, second] of times.entries()) {
      const path = join(root, `frame-${index}.jpg`);
      await execFileAsync(
        resolveFfmpegExecutable(),
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-ss",
          String(second),
          "-i",
          inputPath,
          "-map",
          "0:v:0",
          "-frames:v",
          "1",
          "-vf",
          "scale='min(960,iw)':-2",
          "-q:v",
          "3",
          path,
        ],
        { timeout: 30_000, windowsHide: true },
      );
      const bytes = await readFile(path);
      if (!bytes.length) throw new Error("VIDEO_FRAME_OUTPUT_EMPTY");
      frames.push({
        frameNumber: index + 1,
        second,
        imageUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
      });
    }
    return { durationSeconds, frames };
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function extractVideoFrameDataUrls(url: string, count = 3) {
  const frameCount = Math.min(6, Math.max(1, Math.floor(count)));
  const root = join(tmpdir(), `cyanyi-frames-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok)
      throw new Error(`VIDEO_FRAME_DOWNLOAD_FAILED:${response.status}`);
    const inputPath = join(root, "input.video");
    await writeFile(inputPath, Buffer.from(await response.arrayBuffer()));
    const outputPattern = join(root, "frame-%02d.jpg");
    try {
      await execFileAsync(
        resolveFfmpegExecutable(),
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          inputPath,
          "-vf",
          "fps=1/2,scale='min(1280,iw)':-2",
          "-frames:v",
          String(frameCount),
          "-q:v",
          "3",
          outputPattern,
        ],
        { timeout: 5 * 60_000, windowsHide: true },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`VIDEO_FRAME_EXTRACTION_FAILED:${message.slice(0, 500)}`);
    }
    const files = (await readdir(root))
      .filter((name) => /^frame-\d+\.jpg$/i.test(name))
      .sort()
      .slice(0, frameCount);
    if (!files.length) throw new Error("VIDEO_FRAME_OUTPUT_EMPTY");
    return Promise.all(
      files.map(async (name) => {
        const bytes = await readFile(join(root, name));
        return `data:image/jpeg;base64,${bytes.toString("base64")}`;
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

function resolveFfmpegExecutable() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (ffmpegStatic) {
    try {
      if (statSync(ffmpegStatic).size > 0) return ffmpegStatic;
    } catch {
      // Fall back to PATH.
    }
  }
  return "ffmpeg";
}
