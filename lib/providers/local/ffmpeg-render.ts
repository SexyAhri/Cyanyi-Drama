import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);

export interface TimelineSegment {
  url: string;
  panelIndex: number;
}

export interface RenderTimelineOptions {
  segments: TimelineSegment[];
  audioUrl?: string | null;
  format?: string;
}

export async function renderTimelineVideo(opts: RenderTimelineOptions) {
  const segments = opts.segments?.filter((s) => s.url);
  if (!segments?.length) throw new Error("TIMELINE_RENDER_SEGMENTS_EMPTY");
  const root = join(tmpdir(), `cyanyi-render-${crypto.randomUUID()}`);
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
      const ext = guessVideoExt(seg.url);
      const path = join(root, `${String(index).padStart(4, "0")}.${ext}`);
      await writeFile(path, Buffer.from(await response.arrayBuffer()));
      inputPaths.push(path);
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
      if (response.ok) {
        audioPath = join(root, "soundtrack.mp3");
        await writeFile(audioPath, Buffer.from(await response.arrayBuffer()));
      }
    }

    const outputPath = join(root, `rendered.${opts.format || "mp4"}`);
    try {
      const executable = resolveFfmpegExecutable();
      const args = buildFfmpegArgs(listPath, audioPath, outputPath);
      await execFileAsync(executable, args, {
        timeout: 30 * 60_000,
        windowsHide: true,
        maxBuffer: 50 * 1024 * 1024,
      });
    } catch (error) {
      if (isMissingExecutable(error))
        throw new Error(
          "FFMPEG_NOT_FOUND: 项目依赖未提供可用 FFmpeg，请重新安装依赖或配置 FFMPEG_PATH",
        );
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`TIMELINE_RENDER_FFMPEG_FAILED:${message.slice(0, 500)}`);
    }

    const bytes = await readFile(outputPath);
    return `data:video/mp4;base64,${bytes.toString("base64")}`;
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

function buildFfmpegArgs(
  listPath: string,
  audioPath: string | null,
  outputPath: string,
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
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-shortest",
      "-movflags",
      "+faststart",
    );
  } else {
    base.push(
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
    );
  }
  base.push(outputPath);
  return base;
}

function guessVideoExt(url: string) {
  const match = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  const ext = match ? match[1].toLowerCase() : "";
  if (["mp4", "webm", "mov", "avi", "mkv"].includes(ext)) return ext;
  return "mp4";
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
