import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { inspectImageBytes } from "./image-inspection";
import { renderTimelineVideo } from "./ffmpeg-render";
import { normalizeRenderSpecification } from "./render-spec";

const exec = promisify(execFile);
describe("actual image framing", () => {
  it("measures decoded dimensions and visibly distinguishes explicit crop from default padding", async () => {
    const executable = process.env.FFMPEG_PATH || ffmpegStatic;
    if (!executable) throw new Error("FFMPEG required for this verification");
    const root = await mkdtemp(join(tmpdir(), "cyanyi-framing-test-"));
    try {
      const input = join(root, "wide.png");
      await exec(executable, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=384x256", "-vf", "drawbox=x=0:y=0:w=4:h=256:color=lime:t=fill", "-frames:v", "1", input], { windowsHide: true });
      const bytes = await readFile(input);
      expect(await inspectImageBytes(bytes)).toEqual({ width: 384, height: 256, method: "ffmpeg_decoded" });
      const source = `data:image/png;base64,${bytes.toString("base64")}`;
      const spec = normalizeRenderSpecification({ width: 256, height: 256, fps: 10 });
      const pixels: Record<string, number[]> = {};
      for (const imageFit of ["contain", "crop"] as const) {
        const rendered = await renderTimelineVideo({ specification: spec, segments: [{ url: source, panelIndex: 0, kind: "image", durationSeconds: 1, imageFit }], subtitles: [{ start: 0.2, end: 0.8, text: "Check" }] });
        const output = join(root, `${imageFit}.mp4`);
        await writeFile(output, Buffer.from(rendered.dataUrl.split(",")[1], "base64"));
        const frame = await exec(executable, ["-hide_banner", "-loglevel", "error", "-ss", "0.1", "-i", output, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], { encoding: "buffer", windowsHide: true, maxBuffer: 1_000_000 });
        pixels[imageFit] = Array.from(frame.stdout.subarray(0, 3));
        if (imageFit === "contain") {
          const lastFrame = await exec(executable, ["-hide_banner", "-loglevel", "error", "-ss", "0.9", "-i", output, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], { encoding: "buffer", windowsHide: true, maxBuffer: 1_000_000 });
          const edgeOffset = (128 * 256) * 3;
          const edgePixel = Array.from(lastFrame.stdout.subarray(edgeOffset, edgeOffset + 3));
          expect(edgePixel[1]).toBeGreaterThan(130);
          expect(edgePixel[0]).toBeLessThan(80);
        }
      }
      expect(pixels.contain.every(value => value < 20)).toBe(true);
      expect(pixels.crop[0]).toBeGreaterThan(180);
      expect(pixels.crop[1]).toBeLessThan(30);
      await expect(inspectImageBytes(Uint8Array.from([1, 2, 3]))).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30_000);
});
