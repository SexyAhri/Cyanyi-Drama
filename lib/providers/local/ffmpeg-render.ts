import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import { assertTimelineRenderBehavior } from "@/lib/quality/behavior-guards";
import {
  normalizeRenderSpecification,
  type RenderSpecification,
} from "./render-spec";

const execFileAsync = promisify(execFile);

export interface TimelineSegment {
  url: string;
  panelIndex: number;
  kind?: "image" | "video";
  durationSeconds?: number;
  sourceStartSeconds?: number;
  volume?: number;
  transition?: "cut" | "fade";
  transitionDurationSeconds?: number;
}

export interface RenderTimelineOptions {
  segments: TimelineSegment[];
  audioUrl?: string | null;
  format?: string;
  specification?: RenderSpecification;
}

export async function renderTimelineVideo(opts: RenderTimelineOptions) {
  const segments = opts.segments.filter((s) => s.url);
  const specification =
    opts.specification ?? normalizeRenderSpecification({ format: opts.format });
  assertTimelineRenderBehavior({ segments, specification });
  const root = join(tmpdir(), `cyanyi-render-${crypto.randomUUID()}`);
  assertRenderTempRoot(root);
  await mkdir(root, { recursive: true });
  try {
    const inputPaths: string[] = [];
    for (let index = 0; index < segments.length; index += 1) {
      const seg = segments[index];
      const response = await fetch(seg.url, { cache: "no-store" });
      if (!response.ok)
        throw new Error(
          `TIMELINE_RENDER_DOWNLOAD_FAILED:${seg.panelIndex}:${response.status}`,
        );
      const ext = guessMediaExt(seg.url, seg.kind);
      const sourcePath = join(root, `${String(index).padStart(4, "0")}.${ext}`);
      const normalizedPath = join(
        root,
        `${String(index).padStart(4, "0")}.normalized.mp4`,
      );
      await writeFile(sourcePath, Buffer.from(await response.arrayBuffer()));
      const hasSourceAudio =
        seg.kind !== "image" && (await hasAudioStream(sourcePath));
      await executeFfmpeg(
        buildNormalizeSegmentArgs(
          sourcePath,
          normalizedPath,
          seg,
          specification,
          hasSourceAudio,
        ),
      );
      inputPaths.push(normalizedPath);
    }

    const listPath = join(root, "inputs.txt");
    await writeFile(
      listPath,
      inputPaths
        .map((path) => `file '${path.replace(/'/g, "'\\''")}'`)
        .join("\n"),
    );

    let audioPath: string | null = null;
    if (opts.audioUrl) {
      const response = await fetch(opts.audioUrl, { cache: "no-store" });
      if (!response.ok)
        throw new Error(`TIMELINE_RENDER_AUDIO_DOWNLOAD_FAILED:${response.status}`);
      audioPath = join(root, "soundtrack.audio");
      await writeFile(audioPath, Buffer.from(await response.arrayBuffer()));
    }

    const outputPath = join(root, "rendered.mp4");
    await executeFfmpeg(
      buildConcatFfmpegArgs(listPath, audioPath, outputPath, specification),
    );

    const bytes = await readFile(outputPath);
    return {
      dataUrl: `data:video/mp4;base64,${bytes.toString("base64")}`,
      specification,
    };
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

function assertRenderTempRoot(root: string) {
  const relativePath = relative(resolve(tmpdir()), resolve(root));
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath))
    throw new Error("TIMELINE_RENDER_TEMP_ROOT_INVALID");
}

export function buildNormalizeSegmentArgs(
  inputPath: string,
  outputPath: string,
  segment: TimelineSegment,
  specification: RenderSpecification,
  hasSourceAudio = segment.kind !== "image",
) {
  const duration = segment.durationSeconds ?? specification.imageDurationSeconds;
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  if (segment.kind !== "image" && segment.sourceStartSeconds)
    args.push("-ss", String(segment.sourceStartSeconds));
  if (segment.kind === "image")
    args.push("-loop", "1", "-framerate", String(specification.fps));
  args.push("-i", inputPath);
  if (!hasSourceAudio)
    args.push(
      "-f",
      "lavfi",
      "-i",
      `anullsrc=channel_layout=stereo:sample_rate=${specification.audioSampleRate}`,
    );
  if (segment.kind === "image" || segment.durationSeconds)
    args.push("-t", String(duration));
  const filters = [
    `scale=${specification.width}:${specification.height}:force_original_aspect_ratio=decrease`,
    `pad=${specification.width}:${specification.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "setsar=1",
  ];
  if (segment.kind !== "image" && segment.durationSeconds)
    filters.push(`tpad=stop_mode=clone:stop_duration=${duration}`);
  const transitionDuration = Math.min(
    Math.max(0.1, segment.transitionDurationSeconds ?? 0.35),
    Math.max(0.1, duration / 2),
  );
  if (segment.transition === "fade")
    filters.push(
      `fade=t=in:st=0:d=${transitionDuration}`,
      `fade=t=out:st=${Math.max(0, duration - transitionDuration)}:d=${transitionDuration}`,
    );
  filters.push(`fps=${specification.fps}`, `format=${specification.pixelFormat}`);
  const audioFilters = [
    `volume=${Math.min(2, Math.max(0, segment.volume ?? 1))}`,
  ];
  if (segment.transition === "fade")
    audioFilters.push(
      `afade=t=in:st=0:d=${transitionDuration}`,
      `afade=t=out:st=${Math.max(0, duration - transitionDuration)}:d=${transitionDuration}`,
    );
  audioFilters.push("apad");
  args.push(
    "-map",
    "0:v:0",
    "-map",
    `${hasSourceAudio ? 0 : 1}:a:0`,
    "-vf",
    filters.join(","),
    "-c:v",
    specification.videoCodec,
    "-preset",
    "fast",
    "-crf",
    String(specification.crf),
    "-r",
    String(specification.fps),
    "-g",
    String(Math.max(1, Math.round(specification.fps * 2))),
    "-video_track_timescale",
    "90000",
    "-c:a",
    specification.audioCodec,
    "-b:a",
    "192k",
    "-ar",
    String(specification.audioSampleRate),
    "-ac",
    String(specification.audioChannels),
    "-af",
    audioFilters.join(","),
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath,
  );
  return args;
}

export function buildConcatFfmpegArgs(
  listPath: string,
  audioPath: string | null,
  outputPath: string,
  specification: RenderSpecification,
) {
  const base = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
  ];
  if (audioPath) {
    base.push("-i", audioPath);
    base.push(
      "-filter_complex",
      "[0:a:0][1:a:0]amix=inputs=2:duration=first:dropout_transition=0:weights=0.5 1:normalize=0[mixed]",
      "-c:v",
      "copy",
      "-c:a",
      specification.audioCodec,
      "-b:a",
      "192k",
      "-ar",
      String(specification.audioSampleRate),
      "-ac",
      String(specification.audioChannels),
      "-map",
      "0:v:0",
      "-map",
      "[mixed]",
      "-movflags",
      "+faststart",
    );
  } else {
    base.push(
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-movflags",
      "+faststart",
    );
  }
  base.push(outputPath);
  return base;
}

async function hasAudioStream(inputPath: string) {
  try {
    await executeFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-map",
      "0:a:0",
      "-frames:a",
      "1",
      "-f",
      "null",
      "-",
    ]);
    return true;
  } catch {
    return false;
  }
}

function guessMediaExt(url: string, kind?: "image" | "video") {
  const match = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  const ext = match ? match[1].toLowerCase() : "";
  if (
    ["mp4", "webm", "mov", "avi", "mkv", "png", "jpg", "jpeg", "webp"].includes(
      ext,
    )
  )
    return ext;
  return kind === "image" ? "png" : "mp4";
}

async function executeFfmpeg(args: string[]) {
  for (const executable of resolveFfmpegExecutables()) {
    try {
      await execFileAsync(executable, args, {
        timeout: 30 * 60_000,
        windowsHide: true,
        maxBuffer: 50 * 1024 * 1024,
      });
      return;
    } catch (error) {
      if (isMissingExecutable(error)) continue;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`TIMELINE_RENDER_FFMPEG_FAILED:${message.slice(0, 500)}`);
    }
  }
  throw new Error(
    "FFMPEG_NOT_FOUND: 项目依赖未提供可用 FFmpeg，请重新安装依赖或配置 FFMPEG_PATH",
  );
}

function isMissingExecutable(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["ENOENT", "EFTYPE", "EINVAL"].includes(
    String((error as { code?: unknown }).code),
  );
}

function resolveFfmpegExecutables() {
  const candidates: string[] = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  if (ffmpegStatic) {
    try {
      if (statSync(ffmpegStatic).size > 0) candidates.push(ffmpegStatic);
    } catch {
      // Fall back to PATH so a system installation still works.
    }
  }
  candidates.push("ffmpeg");
  return [...new Set(candidates)];
}
