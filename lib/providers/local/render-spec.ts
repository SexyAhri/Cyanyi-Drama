export type RenderSpecification = {
  format: "mp4";
  width: number;
  height: number;
  fps: number;
  videoCodec: "libx264";
  pixelFormat: "yuv420p";
  crf: number;
  audioCodec: "aac";
  audioSampleRate: 48000;
  audioChannels: 2;
  imageDurationSeconds: number;
};

const RESOLUTION_HEIGHTS = {
  "720p": 720,
  "1080p": 1080,
  "2160p": 2160,
  "4k": 2160,
} as const;

const ASPECT_RATIOS = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
  "1:1": 1,
} as const;

export function normalizeRenderSpecification(
  input: Record<string, unknown> = {},
): RenderSpecification {
  const format = stringValue(input.format) || "mp4";
  if (format !== "mp4") throw new Error(`RENDER_FORMAT_UNSUPPORTED:${format}`);
  const fps = finiteNumber(input.fps) ?? 24;
  if (fps < 1 || fps > 60) throw new Error("RENDER_FPS_INVALID");
  const explicitWidth = finiteInteger(input.width);
  const explicitHeight = finiteInteger(input.height);
  let width: number;
  let height: number;
  if (explicitWidth !== null || explicitHeight !== null) {
    if (explicitWidth === null || explicitHeight === null)
      throw new Error("RENDER_DIMENSIONS_INCOMPLETE");
    width = explicitWidth;
    height = explicitHeight;
  } else {
    const resolution = stringValue(input.resolution).toLowerCase() || "1080p";
    const baseHeight =
      RESOLUTION_HEIGHTS[resolution as keyof typeof RESOLUTION_HEIGHTS];
    if (!baseHeight) throw new Error(`RENDER_RESOLUTION_UNSUPPORTED:${resolution}`);
    const aspect = stringValue(input.aspectRatio ?? input.ratio) || "16:9";
    const ratio = ASPECT_RATIOS[aspect as keyof typeof ASPECT_RATIOS];
    if (!ratio) throw new Error(`RENDER_ASPECT_RATIO_UNSUPPORTED:${aspect}`);
    if (ratio >= 1) {
      height = baseHeight;
      width = even(Math.round(height * ratio));
    } else {
      width = baseHeight;
      height = even(Math.round(width / ratio));
    }
  }
  if (width < 256 || height < 256 || width > 3840 || height > 3840)
    throw new Error("RENDER_DIMENSIONS_OUT_OF_RANGE");
  width = even(width);
  height = even(height);
  const imageDurationSeconds = finiteNumber(input.imageDurationSeconds) ?? 3;
  if (imageDurationSeconds < 0.5 || imageDurationSeconds > 30)
    throw new Error("RENDER_IMAGE_DURATION_INVALID");
  return {
    format: "mp4",
    width,
    height,
    fps,
    videoCodec: "libx264",
    pixelFormat: "yuv420p",
    crf: 20,
    audioCodec: "aac",
    audioSampleRate: 48000,
    audioChannels: 2,
    imageDurationSeconds,
  };
}

function finiteInteger(value: unknown) {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function even(value: number) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
