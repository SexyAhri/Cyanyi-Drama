type SeedanceRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";

const SEEDANCE_RATIOS: SeedanceRatio[] = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "21:9",
];

const RATIO_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*[:：xX]\s*(\d+(?:\.\d+)?)\s*$/;
const SIZE_PATTERN = /^\s*(\d+)\s*x\s*(\d+)\s*$/i;

export function isSeedanceVideoModel(model?: string) {
  const value = model?.trim().toLowerCase() ?? "";

  return value.includes("seedance") || value.includes("doubao-seedance");
}

export function normalizeOpenAICompatibleVideoSeconds(
  value?: string,
  model?: string,
) {
  const seconds = Math.floor(parseDurationSeconds(value) ?? 6);
  const normalizedModel = model?.trim().toLowerCase() ?? "";
  const normalizedSeconds = String(seconds);

  if (normalizedModel.startsWith("grok-imagine-video")) {
    return normalizedSeconds === "10" ? "10" : "6";
  }

  return String(Math.max(1, Math.min(20, seconds)));
}

export function normalizeOpenAICompatibleVideoSize(value?: string) {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (!normalized || normalized === "auto" || normalized === "adaptive") {
    return undefined;
  }

  if (SIZE_PATTERN.test(normalized)) {
    return normalized.replace(/\s+/g, "");
  }

  const ratio = normalizeRatioToken(normalized);

  if (ratio === "1:1") {
    return "1024x1024";
  }

  if (ratio === "9:16" || ratio === "2:3" || ratio === "3:4") {
    return "720x1280";
  }

  if (ratio === "21:9") {
    return "1792x1024";
  }

  return "1280x720";
}

export function normalizeOpenAICompatibleVideoResolution(value?: string) {
  const normalized = normalizeResolutionToken(value);

  if (normalized === "low") {
    return "480p";
  }

  if (
    normalized === "auto" ||
    normalized === "high" ||
    normalized === "medium"
  ) {
    return "720p";
  }

  const resolution = normalized.replace(/p$/i, "") || "720";

  return `${resolution}p`;
}

export function normalizeSeedanceDuration(value?: string) {
  if (String(value ?? "").trim() === "-1") {
    return -1;
  }

  const seconds = Math.floor(parseDurationSeconds(value) ?? 5);

  return Math.max(4, Math.min(15, seconds));
}

export function normalizeSeedanceRatio(value?: string) {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (!normalized || normalized === "auto" || normalized === "adaptive") {
    return "adaptive";
  }

  const ratio = normalizeRatioToken(normalized);

  if (SEEDANCE_RATIOS.includes(ratio as SeedanceRatio)) {
    return ratio as SeedanceRatio;
  }

  const size = parseSize(normalized);

  if (!size) {
    return "adaptive";
  }

  return getNearestSeedanceRatio(size.width / size.height);
}

export function normalizeSeedanceResolution(value?: string, model = "") {
  const normalized = normalizeOpenAICompatibleVideoResolution(value);

  if (isSeedanceFastModel(model) && normalized === "1080p") {
    return "720p";
  }

  return normalized === "480p" ||
    normalized === "720p" ||
    normalized === "1080p"
    ? normalized
    : "720p";
}

function isSeedanceFastModel(model: string) {
  const value = model.trim().toLowerCase();

  return isSeedanceVideoModel(value) && value.includes("fast");
}

function normalizeResolutionToken(value?: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function parseDurationSeconds(value?: string) {
  const match = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
  const seconds = match ? Number(match[0]) : Number.NaN;

  return Number.isFinite(seconds) ? seconds : undefined;
}

function normalizeRatioToken(value: string) {
  const match = value.match(RATIO_PATTERN);

  if (!match) {
    return value;
  }

  return `${Number(match[1])}:${Number(match[2])}`;
}

function parseSize(value: string) {
  const match = value.match(SIZE_PATTERN);

  if (!match) {
    return null;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);

  if (!width || !height) {
    return null;
  }

  return { height, width };
}

function getNearestSeedanceRatio(targetRatio: number): SeedanceRatio {
  const ratios: Array<[SeedanceRatio, number]> = [
    ["16:9", 16 / 9],
    ["4:3", 4 / 3],
    ["1:1", 1],
    ["3:4", 3 / 4],
    ["9:16", 9 / 16],
    ["21:9", 21 / 9],
  ];

  return ratios.reduce((best, item) =>
    Math.abs(item[1] - targetRatio) < Math.abs(best[1] - targetRatio)
      ? item
      : best,
  )[0];
}
