import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);

export async function inspectImageBytes(bytes: Uint8Array) {
  const executable = process.env.FFMPEG_PATH || ffmpegStatic;
  if (!executable) throw new Error("IMAGE_INSPECTION_FFMPEG_MISSING");
  const root = await mkdtemp(join(tmpdir(), "cyanyi-image-inspect-"));
  const within = relative(resolve(tmpdir()), resolve(root));
  if (!within || within.startsWith("..") || within.includes(":"))
    throw new Error("IMAGE_INSPECTION_TEMP_PATH_INVALID");
  try {
    const file = join(root, "source.image");
    await writeFile(file, bytes);
    const { stderr } = await execFileAsync(
      executable,
      ["-hide_banner", "-i", file, "-frames:v", "1", "-f", "null", "-"],
      { windowsHide: true, timeout: 30_000, maxBuffer: 512_000 },
    );
    const stream = stderr
      .split(/\r?\n/)
      .find((line) => /Stream #.*Video:/.test(line));
    const size = stream?.match(/(?:,|\s)(\d{1,6})x(\d{1,6})(?:\s|,|\[)/);
    if (!size || !Number(size[1]) || !Number(size[2]))
      throw new Error("IMAGE_OUTPUT_DIMENSIONS_UNKNOWN");
    return {
      width: Number(size[1]),
      height: Number(size[2]),
      method: "ffmpeg_decoded" as const,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
