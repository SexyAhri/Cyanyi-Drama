type ImageSize = {
  height: number;
  size: string;
  width: number;
};

type PresetRatio =
  | "1:1"
  | "3:2"
  | "2:3"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4"
  | "21:9";
type ResolutionPreset = "720p" | "1080p" | "2k" | "4k";

const RATIO_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*[:：xX]\s*(\d+(?:\.\d+)?)\s*$/;
const SIZE_MULTIPLE = 16;
const MIN_PIXELS = 655360;
const MAX_EDGE = 3840;
const MAX_PIXELS = 8294400;
const MAX_ASPECT_RATIO = 3;
const MAX_RATIO_ERROR = 0.01;

const COMMON_SIZE_PRESETS: Record<
  ResolutionPreset,
  Record<PresetRatio, string>
> = {
  "720p": {
    "1:1": "1024x1024",
    "3:2": "1248x832",
    "2:3": "832x1248",
    "16:9": "1360x768",
    "9:16": "768x1360",
    "4:3": "1168x880",
    "3:4": "880x1168",
    "21:9": "1552x672",
  },
  "1080p": {
    "1:1": "1072x1072",
    "3:2": "1600x1072",
    "2:3": "1072x1600",
    "16:9": "1904x1072",
    "9:16": "1072x1904",
    "4:3": "1424x1072",
    "3:4": "1072x1424",
    "21:9": "2496x1072",
  },
  "2k": {
    "1:1": "2048x2048",
    "3:2": "2496x1664",
    "2:3": "1664x2496",
    "16:9": "2720x1536",
    "9:16": "1536x2720",
    "4:3": "2352x1760",
    "3:4": "1760x2352",
    "21:9": "3120x1344",
  },
  "4k": {
    "1:1": "2880x2880",
    "3:2": "3520x2352",
    "2:3": "2352x3520",
    "16:9": "3840x2160",
    "9:16": "2160x3840",
    "4:3": "3312x2480",
    "3:4": "2480x3312",
    "21:9": "3840x1648",
  },
};

const PIXEL_BUDGETS: Record<ResolutionPreset, number> = {
  "720p": 1024 * 1024,
  "1080p": 1920 * 1080,
  "2k": 2048 * 2048,
  "4k": MAX_PIXELS,
};

const FORMULA_RESOLUTIONS = new Set<ResolutionPreset>(["720p", "2k", "4k"]);

export function getOpenAICompatibleImageSizeCandidates(
  resolution: string,
  ratio: string,
) {
  const normalizedResolution = normalizeResolution(resolution);
  const size = calculateImageSize(normalizedResolution, ratio);

  return size ? [size] : [];
}

function normalizeResolution(resolution: string): ResolutionPreset {
  const normalized = resolution.trim().toLowerCase();

  if (
    normalized === "720p" ||
    normalized === "1080p" ||
    normalized === "2k" ||
    normalized === "4k"
  ) {
    return normalized;
  }

  return "1080p";
}

function calculateImageSize(resolution: ResolutionPreset, ratio: string) {
  const parsedRatio = parseRatio(ratio);

  if (!parsedRatio) {
    return parseSize(COMMON_SIZE_PRESETS[resolution]["1:1"]);
  }

  const presetRatio = getPresetRatioKey(parsedRatio.width, parsedRatio.height);

  if (presetRatio) {
    return parseSize(COMMON_SIZE_PRESETS[resolution][presetRatio]);
  }

  if (FORMULA_RESOLUTIONS.has(resolution)) {
    return calculateCustomRatioSize(
      PIXEL_BUDGETS[resolution],
      parsedRatio.width / parsedRatio.height,
    );
  }

  return calculateCustomRatioSize(
    PIXEL_BUDGETS[resolution],
    parsedRatio.width / parsedRatio.height,
  );
}

function parseRatio(ratio: string) {
  const match = ratio.match(RATIO_PATTERN);

  if (!match) {
    return null;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return { height, width };
}

function getPresetRatioKey(width: number, height: number): PresetRatio | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return null;
  }

  const divisor = gcd(width, height);
  const key = `${width / divisor}:${height / divisor}`;

  return key in COMMON_SIZE_PRESETS["720p"] ? (key as PresetRatio) : null;
}

function calculateCustomRatioSize(pixelBudget: number, targetRatio: number) {
  let bestHeight = 0;
  let bestPixels = 0;
  let bestWidth = 0;

  for (let width = SIZE_MULTIPLE; width <= MAX_EDGE; width += SIZE_MULTIPLE) {
    const idealHeight = width / targetRatio;
    const candidates = [
      Math.floor(idealHeight / SIZE_MULTIPLE) * SIZE_MULTIPLE,
      Math.ceil(idealHeight / SIZE_MULTIPLE) * SIZE_MULTIPLE,
    ];

    for (const height of candidates) {
      if (height < SIZE_MULTIPLE || height > MAX_EDGE) {
        continue;
      }

      if (Math.max(width / height, height / width) > MAX_ASPECT_RATIO) {
        continue;
      }

      const pixels = width * height;

      if (pixels < MIN_PIXELS || pixels > pixelBudget || pixels > MAX_PIXELS) {
        continue;
      }

      const ratioError = Math.abs(width / height - targetRatio) / targetRatio;

      if (ratioError > MAX_RATIO_ERROR) {
        continue;
      }

      if (pixels > bestPixels) {
        bestHeight = height;
        bestPixels = pixels;
        bestWidth = width;
      }
    }
  }

  return bestPixels > 0
    ? {
        height: bestHeight,
        size: `${bestWidth}x${bestHeight}`,
        width: bestWidth,
      }
    : null;
}

function parseSize(size: string): ImageSize {
  const [width, height] = size.split("x").map(Number);

  return {
    height,
    size,
    width,
  };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
