import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);

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
