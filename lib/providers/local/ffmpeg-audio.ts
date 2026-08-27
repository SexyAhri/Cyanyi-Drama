import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);

export async function mergeAudioUrls(
  urls: string[],
  options: { playbackRate?: number } = {},
) {
  if (!urls.length) throw new Error("AUDIO_MERGE_INPUT_EMPTY");
  const root = join(tmpdir(), `cyanyi-audio-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    const inputPaths: string[] = [];
    for (let index = 0; index < urls.length; index += 1) {
      const response = await fetch(urls[index], { cache: "no-store" });
      if (!response.ok)
        throw new Error(
          `AUDIO_MERGE_DOWNLOAD_FAILED:${index + 1}:${response.status}`,
        );
      const path = join(root, `${String(index).padStart(4, "0")}.audio`);
      await writeFile(path, Buffer.from(await response.arrayBuffer()));
      inputPaths.push(path);
    }
    const outputPath = join(root, "merged.mp3");
    try {
      const executable = resolveFfmpegExecutable();
      const playbackRate = options.playbackRate ?? 1;
      const filters = inputPaths.map(
        (_path, index) =>
          `[${index}:a]aresample=44100,asetpts=PTS-STARTPTS${playbackRate === 1 ? "" : `,atempo=${playbackRate.toFixed(6)}`}[a${index}]`,
      );
      filters.push(
        `${inputPaths.map((_path, index) => `[a${index}]`).join("")}concat=n=${inputPaths.length}:v=0:a=1[out]`,
      );
      await execFileAsync(
        executable,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          ...inputPaths.flatMap((path) => ["-i", path]),
          "-filter_complex",
          filters.join(";"),
          "-map",
          "[out]",
          "-vn",
          "-c:a",
          "libmp3lame",
          "-b:a",
          "192k",
          outputPath,
        ],
        { timeout: 10 * 60_000, windowsHide: true },
      );
    } catch (error) {
      if (isMissingExecutable(error))
        throw new Error(
          "FFMPEG_NOT_FOUND: 项目依赖未提供可用 FFmpeg，请重新安装依赖或配置 FFMPEG_PATH",
        );
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`AUDIO_MERGE_FFMPEG_FAILED:${message.slice(0, 500)}`);
    }
    const bytes = await readFile(outputPath);
    return `data:audio/mpeg;base64,${bytes.toString("base64")}`;
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function probeAudioUrlDuration(url: string) {
  const root = join(tmpdir(), `cyanyi-audio-probe-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok)
      throw new Error(`AUDIO_PROBE_DOWNLOAD_FAILED:${response.status}`);
    const inputPath = join(root, "input.audio");
    await writeFile(inputPath, Buffer.from(await response.arrayBuffer()));
    const executable = resolveFfmpegExecutable();
    const { stderr } = await execFileAsync(
      executable,
      ["-hide_banner", "-i", inputPath, "-f", "null", "-"],
      { timeout: 2 * 60_000, windowsHide: true },
    );
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) throw new Error("AUDIO_PROBE_DURATION_MISSING");
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function composeAudioTimeline(
  clips: Array<{
    url: string;
    startSeconds: number;
    durationSeconds: number;
    playbackRate?: number;
  }>,
  durationSeconds: number,
) {
  if (!clips.length) throw new Error("AUDIO_TIMELINE_INPUT_EMPTY");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
    throw new Error("AUDIO_TIMELINE_DURATION_INVALID");
  const root = join(tmpdir(), `cyanyi-audio-timeline-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  try {
    const inputPaths: string[] = [];
    for (let index = 0; index < clips.length; index += 1) {
      const response = await fetch(clips[index].url, { cache: "no-store" });
      if (!response.ok)
        throw new Error(
          `AUDIO_TIMELINE_DOWNLOAD_FAILED:${index + 1}:${response.status}`,
        );
      const path = join(root, `${String(index).padStart(4, "0")}.audio`);
      await writeFile(path, Buffer.from(await response.arrayBuffer()));
      inputPaths.push(path);
    }
    const filters = buildAudioTimelineFilter(clips, durationSeconds);
    const outputPath = join(root, "timeline.mp3");
    try {
      await execFileAsync(
        resolveFfmpegExecutable(),
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          ...inputPaths.flatMap((path) => ["-i", path]),
          "-filter_complex",
          filters.join(";"),
          "-map",
          "[out]",
          "-vn",
          "-c:a",
          "libmp3lame",
          "-b:a",
          "192k",
          outputPath,
        ],
        { timeout: 10 * 60_000, windowsHide: true },
      );
    } catch (error) {
      if (isMissingExecutable(error))
        throw new Error(
          "FFMPEG_NOT_FOUND: 项目依赖未提供可用 FFmpeg，请重新安装依赖或配置 FFMPEG_PATH",
        );
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`AUDIO_TIMELINE_FFMPEG_FAILED:${message.slice(0, 500)}`);
    }
    const bytes = await readFile(outputPath);
    return `data:audio/mpeg;base64,${bytes.toString("base64")}`;
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function buildAudioTimelineFilter(
  clips: Array<{
    startSeconds: number;
    durationSeconds: number;
    playbackRate?: number;
  }>,
  durationSeconds: number,
) {
  const ordered = clips
    .map((clip, inputIndex) => ({ ...clip, inputIndex }))
    .sort((left, right) => left.startSeconds - right.startSeconds);
  const filters: string[] = [];
  const segments: string[] = [];
  let cursor = 0;
  let silenceIndex = 0;
  for (const clip of ordered) {
    if (clip.startSeconds < cursor - 0.01)
      throw new Error("AUDIO_TIMELINE_CLIP_OVERLAP");
    const gap = Math.max(0, clip.startSeconds - cursor);
    if (gap > 0.001) {
      const label = `silence${silenceIndex++}`;
      filters.push(`anullsrc=r=44100:cl=mono:d=${gap.toFixed(6)}[${label}]`);
      segments.push(`[${label}]`);
    }
    const playbackRate = clip.playbackRate ?? 1;
    const label = `audio${clip.inputIndex}`;
    filters.push(
      `[${clip.inputIndex}:a]aresample=44100${playbackRate === 1 ? "" : `,atempo=${playbackRate.toFixed(6)}`},apad=pad_dur=${clip.durationSeconds.toFixed(6)},atrim=duration=${clip.durationSeconds.toFixed(6)},aformat=channel_layouts=mono,asetpts=N/SR/TB[${label}]`,
    );
    segments.push(`[${label}]`);
    cursor = clip.startSeconds + clip.durationSeconds;
  }
  const trailingSilence = durationSeconds - cursor;
  if (trailingSilence < -0.01)
    throw new Error("AUDIO_TIMELINE_EXCEEDS_DURATION");
  if (trailingSilence > 0.001) {
    const label = `silence${silenceIndex}`;
    filters.push(
      `anullsrc=r=44100:cl=mono:d=${trailingSilence.toFixed(6)}[${label}]`,
    );
    segments.push(`[${label}]`);
  }
  filters.push(
    `${segments.join("")}concat=n=${segments.length}:v=0:a=1,atrim=duration=${durationSeconds},asetpts=N/SR/TB[out]`,
  );
  return filters;
}

function isMissingExecutable(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["ENOENT", "EFTYPE", "EINVAL"].includes(
    String((error as { code?: unknown }).code),
  );
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
