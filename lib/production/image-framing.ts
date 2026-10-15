export type ImageFit = "contain" | "crop";

export function aspectRatioValue(value: string) {
  const [width, height] = value.split(":").map(Number);
  return width > 0 && height > 0 ? width / height : 16 / 9;
}

export function imageAspectAssessment(
  metadata: Record<string, unknown>,
  targetRatio: string,
) {
  const inspection = metadata.imageInspection as
    | { width?: unknown; height?: unknown; method?: unknown }
    | undefined;
  const width = inspection?.width;
  const height = inspection?.height;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    width <= 0 ||
    height <= 0
  )
    return { measured: false as const, mismatch: false, targetRatio };
  return {
    measured: true as const,
    width,
    height,
    targetRatio,
    mismatch:
      Math.abs(width / height / aspectRatioValue(targetRatio) - 1) > 0.01,
  };
}
