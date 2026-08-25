import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);

export async function mergeAudioUrls(urls: string[]) {
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
    const listPath = join(root, "inputs.txt");
    await writeFile(
      listPath,
      inputPaths
        .map((path) => `file '${path.replace(/'/g, "'\\''")}'`)
        .join("\n"),
    );
    const outputPath = join(root, "merged.mp3");
    try {
      const executable = resolveFfmpegExecutable();
      await execFileAsync(
        executable,
        [
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
