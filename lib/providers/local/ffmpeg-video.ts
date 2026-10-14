import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);

export function parseVideoInspection(stderr: string) {
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/u);
  const durationSeconds = match
    ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    : null;
  if (
    !/Stream #.*Video:/u.test(stderr) ||
    !durationSeconds ||
    durationSeconds <= 0
  )
    throw new Error("VIDEO_OUTPUT_INSPECTION_INVALID");
  return { durationSeconds, hasAudio: /Stream #.*Audio:/u.test(stderr) };
}

export async function inspectVideoBytes(
  bytes: Uint8Array,
  options: { requireAudio: boolean; expectedDurationSeconds?: number },
) {
  const root = await mkdtemp(join(tmpdir(), "cyanyi-video-inspect-"));
  const cleanupTarget = resolve(root);
  const cleanupRelative = relative(resolve(tmpdir()), cleanupTarget);
  if (
    cleanupRelative.startsWith("..") ||
    !cleanupRelative ||
    cleanupRelative.includes(":")
  )
    throw new Error("VIDEO_INSPECTION_TEMP_PATH_INVALID");
  try {
    const inputPath = join(root, "input.mp4");
    await writeFile(inputPath, bytes);
    let stderr = "";
    try {
      const result = await execFileAsync(
        resolveFfmpegExecutable(),
        ["-hide_banner", "-i", inputPath],
        { timeout: 30_000, windowsHide: true },
      );
      stderr = result.stderr;
    } catch (error) {
      if (isMissingExecutable(error)) throw new Error("FFMPEG_NOT_FOUND");
      if (!error || typeof error !== "object" || !("stderr" in error))
        throw error;
      stderr = String(error.stderr);
    }
    const inspection = parseVideoInspection(stderr);
    if (options.requireAudio && !inspection.hasAudio)
      throw new Error(
        "VIDEO_OUTPUT_AUDIO_MISSING: 模型结果缺少要求的原生音轨，请更换模型或制作方式",
      );
    const expected = options.expectedDurationSeconds;
    if (
      expected &&
      Math.abs(inspection.durationSeconds - expected) >
        Math.max(1, expected * 0.1)
    )
      throw new Error(
        `VIDEO_OUTPUT_DURATION_MISMATCH: expected=${expected}, actual=${inspection.durationSeconds}`,
      );
    let audioDurationSeconds: number | null = null;
    if (inspection.hasAudio) {
      const decoded = await execFileAsync(
        resolveFfmpegExecutable(),
        [
          "-hide_banner",
          "-i",
          inputPath,
          "-map",
          "0:a:0",
          "-vn",
          "-f",
          "null",
          "-",
        ],
        { timeout: 120_000, windowsHide: true },
      );
      const times = [
        ...decoded.stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/gu),
      ];
      const last = times.at(-1);
      if (!last) throw new Error("VIDEO_OUTPUT_AUDIO_DURATION_UNKNOWN");
      audioDurationSeconds =
        Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
      if (
        Math.abs(audioDurationSeconds - inspection.durationSeconds) >
        Math.max(0.5, inspection.durationSeconds * 0.05)
      )
        throw new Error(
          `VIDEO_OUTPUT_AUDIO_DURATION_MISMATCH: video=${inspection.durationSeconds}, audio=${audioDurationSeconds}`,
        );
    }
    return {
      ...inspection,
      audioDurationSeconds,
      method: "ffmpeg" as const,
      speechCoverage: "not_checked" as const,
    };
  } finally {
    await rm(cleanupTarget, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

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
