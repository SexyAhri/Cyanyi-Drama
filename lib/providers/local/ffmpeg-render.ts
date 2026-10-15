import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import { assertTimelineRenderBehavior } from "@/lib/quality/behavior-guards";
import { readStoredObject } from "@/lib/storage";
import {
  normalizeRenderSpecification,
  type RenderSpecification,
} from "./render-spec";

const execFileAsync = promisify(execFile);

export interface TimelineSegment {
  url?: string;
  storageKey?: string;
  panelIndex: number;
  kind?: "image" | "video";
  durationSeconds?: number;
  sourceStartSeconds?: number;
  volume?: number;
  requiresAudio?: boolean;
  transition?: "cut" | "fade";
  transitionDurationSeconds?: number;
  imageFit?: "contain" | "crop";
}

export interface TimelineSubtitleCue {
  start: number;
  end: number;
  text: string;
}

export type TimelineAudioTrackKind =
  | "dialogue"
  | "ambience"
  | "sfx"
  | "music";

export interface TimelineAudioTrack {
  url?: string | null;
  storageKey?: string | null;
  kind: TimelineAudioTrackKind;
  startSeconds?: number;
  endSeconds?: number | null;
  volume?: number;
  loop?: boolean;
}

export interface MaterializedTimelineAudioTrack
  extends Omit<TimelineAudioTrack, "url" | "storageKey"> {
  path: string;
}

export interface RenderTimelineOptions {
  segments: TimelineSegment[];
  audioUrl?: string | null;
  audioStorageKey?: string | null;
  audioTracks?: readonly TimelineAudioTrack[];
  subtitles?: readonly TimelineSubtitleCue[];
  format?: string;
  specification?: RenderSpecification;
}

export async function renderTimelineVideo(opts: RenderTimelineOptions) {
  const segments = opts.segments.filter((s) => s.url || s.storageKey);
  const specification =
    opts.specification ?? normalizeRenderSpecification({ format: opts.format });
  assertTimelineRenderBehavior({ segments, specification });
  const root = join(tmpdir(), `cyanyi-render-${crypto.randomUUID()}`);
  assertRenderTempRoot(root);
  await mkdir(root, { recursive: true });
  try {
    const inputPaths: string[] = [];
    let hasSourceAudio = false;
    for (let index = 0; index < segments.length; index += 1) {
      const seg = segments[index];
      const ext = guessMediaExt(seg.storageKey ?? seg.url ?? "", seg.kind);
      const sourcePath = join(root, `${String(index).padStart(4, "0")}.${ext}`);
      const normalizedPath = join(
        root,
        `${String(index).padStart(4, "0")}.normalized.mp4`,
      );
      await writeMediaSource({
        url: seg.url,
        storageKey: seg.storageKey,
        outputPath: sourcePath,
        errorCode: `TIMELINE_RENDER_DOWNLOAD_FAILED:${seg.panelIndex}`,
      });
      const segmentHasAudio = seg.kind !== "image" && await hasAudioStream(sourcePath);
      hasSourceAudio ||= segmentHasAudio && seg.volume !== 0;
      if (seg.requiresAudio && (!segmentHasAudio || seg.volume === 0))
        throw new Error(`TIMELINE_RENDER_SOURCE_AUDIO_MISSING:${seg.panelIndex}`);
      await executeFfmpeg(
        buildNormalizeSegmentArgs(
          sourcePath,
          normalizedPath,
          seg,
          specification,
          segmentHasAudio,
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
    if (opts.audioUrl || opts.audioStorageKey) {
      audioPath = join(root, "soundtrack.audio");
      await writeMediaSource({
        url: opts.audioUrl,
        storageKey: opts.audioStorageKey,
        outputPath: audioPath,
        errorCode: "TIMELINE_RENDER_AUDIO_DOWNLOAD_FAILED",
      });
    }

    const audioTracks: MaterializedTimelineAudioTrack[] = [];
    for (let index = 0; index < (opts.audioTracks?.length ?? 0); index += 1) {
      const track = opts.audioTracks![index];
      if (!track.url && !track.storageKey) continue;
      const path = join(root, `soundtrack-${String(index).padStart(3, "0")}.audio`);
      await writeMediaSource({
        url: track.url,
        storageKey: track.storageKey,
        outputPath: path,
        errorCode: `TIMELINE_RENDER_AUDIO_TRACK_DOWNLOAD_FAILED:${index}`,
      });
      audioTracks.push({
        path,
        kind: track.kind,
        startSeconds: track.startSeconds,
        endSeconds: track.endSeconds,
        volume: track.volume,
        loop: track.loop,
      });
    }

    let subtitlePath: string | null = null;
    if (opts.subtitles?.length) {
      const srt = buildSubtitleSrt(opts.subtitles, specification);
      if (srt) {
        subtitlePath = join(root, "subtitles.srt");
        await writeFile(subtitlePath, srt, "utf8");
      }
    }

    const outputPath = join(root, "rendered.mp4");
    const durationSeconds = segments.reduce(
      (total, segment) =>
        total + (segment.durationSeconds ?? specification.imageDurationSeconds),
      0,
    );
    await executeFfmpeg(
      buildConcatFfmpegArgs(
        listPath,
        audioPath,
        outputPath,
        specification,
        subtitlePath,
        audioTracks,
        durationSeconds,
      ),
    );

    const bytes = await readFile(outputPath);
    return {
      dataUrl: `data:video/mp4;base64,${bytes.toString("base64")}`,
      specification,
      hasAudio: hasSourceAudio || !!audioPath || audioTracks.length > 0,
    };
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function writeMediaSource(input: {
  url?: string | null;
  storageKey?: string | null;
  outputPath: string;
  errorCode: string;
}) {
  if (input.storageKey) {
    await writeFile(input.outputPath, await readStoredObject(input.storageKey));
    return;
  }
  if (!input.url) throw new Error(`${input.errorCode}:SOURCE_MISSING`);
  const response = await fetch(input.url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${input.errorCode}:${response.status}`);
  await writeFile(input.outputPath, Buffer.from(await response.arrayBuffer()));
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
  hasSourceAudio = false,
) {
  const duration = segment.durationSeconds ?? specification.imageDurationSeconds;
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  if (segment.kind !== "image" && segment.sourceStartSeconds)
    args.push("-ss", String(segment.sourceStartSeconds));
  if (segment.kind === "image")
    args.push("-loop", "1", "-framerate", String(specification.fps));
  args.push("-i", inputPath);
  args.push(
    "-f",
    "lavfi",
    "-i",
    `anullsrc=channel_layout=stereo:sample_rate=${specification.audioSampleRate}`,
  );
  if (segment.kind === "image" || segment.durationSeconds)
    args.push("-t", String(duration));
  const filters = [
    ...(segment.imageFit === "crop" ? [
      `scale=${specification.width}:${specification.height}:force_original_aspect_ratio=increase`,
      `crop=${specification.width}:${specification.height}`,
    ] : [
      `scale=${specification.width}:${specification.height}:force_original_aspect_ratio=decrease`,
      `pad=${specification.width}:${specification.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    ]),
    "setsar=1",
  ];
  // Keep the saved framing stable throughout the clip so the preview matches
  // the output. An implicit push-in would alter both contain and crop bounds.
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
    hasSourceAudio ? "0:a:0" : "1:a:0",
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
  subtitlePath: string | null = null,
  independentAudioTracks: readonly MaterializedTimelineAudioTrack[] = [],
  durationSeconds = 0,
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
  const videoArgs = subtitlePath
    ? [
        "-vf",
        buildSubtitleVideoFilter(subtitlePath),
        "-c:v",
        specification.videoCodec,
        "-preset",
        "fast",
        "-crf",
        String(specification.crf),
        "-pix_fmt",
        specification.pixelFormat,
        "-r",
        String(specification.fps),
        "-g",
        String(Math.max(1, Math.round(specification.fps * 2))),
        "-video_track_timescale",
        "90000",
      ]
    : ["-c:v", "copy"];
  const audioTracks: MaterializedTimelineAudioTrack[] = [
    ...(audioPath
      ? [{ path: audioPath, kind: "dialogue" as const, volume: 1 }]
      : []),
    ...independentAudioTracks,
  ];
  for (const track of audioTracks) {
    if (track.loop) base.push("-stream_loop", "-1");
    base.push("-i", track.path);
  }
  if (audioTracks.length) {
    const totalDuration = Math.max(0.001, durationSeconds);
    base.push(
      "-filter_complex",
      buildAudioMixFilter(audioTracks, totalDuration, specification.audioSampleRate, !audioTracks.some((track) => track.kind === "dialogue")),
      ...videoArgs,
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
      "-t",
      totalDuration.toFixed(3),
      "-movflags",
      "+faststart",
    );
  } else {
    base.push(
      ...videoArgs,
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

export function buildAudioMixFilter(
  tracks: readonly MaterializedTimelineAudioTrack[],
  durationSeconds: number,
  sampleRate = 48_000,
  includeSourceAudio = false,
) {
  if (!tracks.length) throw new Error("TIMELINE_AUDIO_TRACKS_EMPTY");
  const totalDuration = Math.max(0.001, durationSeconds);
  const filters: string[] = [];
  const dialogueLabels: string[] = [];
  const bedLabels: string[] = [];
  if (includeSourceAudio) {
    filters.push(`[0:a:0]aresample=${sampleRate},aformat=sample_rates=${sampleRate}:channel_layouts=stereo,apad,atrim=duration=${totalDuration.toFixed(3)}[source_audio]`);
    dialogueLabels.push("[source_audio]");
  }

  tracks.forEach((track, index) => {
    const start = clampAudioTime(track.startSeconds ?? 0, totalDuration);
    const end = clampAudioTime(track.endSeconds ?? totalDuration, totalDuration);
    const activeDuration = Math.max(0.001, end - start);
    const volume = Math.min(2, Math.max(0, track.volume ?? 1));
    const label = `track${index}`;
    let chain =
      `[${index + 1}:a:0]aresample=${sampleRate},` +
      `aformat=sample_rates=${sampleRate}:channel_layouts=stereo,` +
      `atrim=duration=${activeDuration.toFixed(3)},asetpts=PTS-STARTPTS`;
    if (track.loop && activeDuration >= 0.2) {
      const fade = Math.min(0.35, activeDuration / 2);
      chain +=
        `,afade=t=in:st=0:d=${fade.toFixed(3)}` +
        `,afade=t=out:st=${Math.max(0, activeDuration - fade).toFixed(3)}:d=${fade.toFixed(3)}`;
    }
    if (start > 0) chain += `,adelay=${Math.round(start * 1_000)}:all=1`;
    chain +=
      `,volume=${volume.toFixed(3)},apad,` +
      `atrim=duration=${totalDuration.toFixed(3)}[${label}]`;
    filters.push(chain);
    (track.kind === "dialogue" ? dialogueLabels : bedLabels).push(`[${label}]`);
  });

  const dialogue = combineAudioLabels(filters, dialogueLabels, "dialogue");
  const bed = combineAudioLabels(filters, bedLabels, "bed");
  if (dialogue && bed) {
    filters.push(
      `${dialogue}asplit=2[dialogue_sidechain][dialogue_mix]`,
      `${bed}[dialogue_sidechain]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=300[ducked]`,
      `[ducked][dialogue_mix]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,atrim=duration=${totalDuration.toFixed(3)}[premaster]`,
    );
  } else {
    filters.push(`${dialogue ?? bed}anull[premaster]`);
  }
  filters.push(
    `[premaster]loudnorm=I=-16:LRA=11:TP=-1.5,atrim=duration=${totalDuration.toFixed(3)}[mixed]`,
  );
  return filters.join(";");
}

function combineAudioLabels(
  filters: string[],
  labels: string[],
  output: string,
) {
  if (!labels.length) return null;
  if (labels.length === 1) {
    filters.push(`${labels[0]}anull[${output}]`);
  } else {
    filters.push(
      `${labels.join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0[${output}]`,
    );
  }
  return `[${output}]`;
}

function clampAudioTime(value: number, durationSeconds: number) {
  return Number.isFinite(value)
    ? Math.min(durationSeconds, Math.max(0, value))
    : 0;
}

export function buildSubtitleSrt(
  cues: readonly TimelineSubtitleCue[],
  specification: RenderSpecification,
) {
  const renderedFontSize =
    (SUBTITLE_ASS_FONT_SIZE * specification.height) / ASS_PLAY_RESOLUTION_Y;
  const maxLineCharacters = Math.max(
    8,
    Math.min(28, Math.floor(specification.width / (renderedFontSize * 1.1))),
  );
  return cues
    .filter(
      (cue) =>
        Number.isFinite(cue.start) &&
        Number.isFinite(cue.end) &&
        cue.end > cue.start &&
        cue.text.trim(),
    )
    .sort((left, right) => left.start - right.start)
    .map((cue, index) => {
      const text = wrapSubtitleText(cue.text, maxLineCharacters);
      return `${index + 1}\n${subtitleTimestamp(cue.start)} --> ${subtitleTimestamp(cue.end)}\n${text}`;
    })
    .filter((cue) => !cue.endsWith("\n"))
    .join("\n\n");
}

export function buildSubtitleVideoFilter(subtitlePath: string) {
  const fontName = process.platform === "win32" ? "Microsoft YaHei" : "Noto Sans CJK SC";
  const options = [`filename='${escapeFilterValue(subtitlePath)}'`];
  if (process.platform === "win32") {
    const fontsDirectory = join(process.env.WINDIR || "C:\\Windows", "Fonts");
    options.push(`fontsdir='${escapeFilterValue(fontsDirectory)}'`);
  }
  options.push(
    `force_style='FontName=${fontName},FontSize=${SUBTITLE_ASS_FONT_SIZE},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=${SUBTITLE_ASS_MARGIN}'`,
  );
  return `subtitles=${options.join(":")}`;
}

// libass scales SRT styles from its 288-line script coordinate system.
const ASS_PLAY_RESOLUTION_Y = 288;
const SUBTITLE_ASS_FONT_SIZE = 16;
const SUBTITLE_ASS_MARGIN = 16;

function subtitleTimestamp(seconds: number) {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1_000));
  const milliseconds = totalMilliseconds % 1_000;
  const totalSeconds = Math.floor(totalMilliseconds / 1_000);
  const second = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minute = totalMinutes % 60;
  const hour = Math.floor(totalMinutes / 60);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function wrapSubtitleText(text: string, maxLineCharacters: number) {
  const value = text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[<>{}]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(value);
  const lines: string[] = [];
  for (let index = 0; index < characters.length; index += maxLineCharacters)
    lines.push(characters.slice(index, index + maxLineCharacters).join(""));
  return lines.join("\n");
}

function escapeFilterValue(value: string) {
  return value
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
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

async function hasAudioStream(inputPath: string) {
  for (const executable of resolveFfmpegExecutables()) {
    try {
      await execFileAsync(executable, ["-hide_banner", "-i", inputPath], { timeout: 30_000, windowsHide: true });
    } catch (error) {
      if (isMissingExecutable(error)) continue;
      // FFmpeg's input inspection exits with code 1 because no output is requested.
      const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
      if (/Stream #.*Video:/u.test(stderr)) return /Stream #.*Audio:/u.test(stderr);
      throw error;
    }
  }
  throw new Error("FFMPEG_NOT_FOUND");
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
