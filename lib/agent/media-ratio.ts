type RatioCandidate = {
  label: string;
  ratio: number;
  scoreBias: number;
};

const COMMON_RATIOS: RatioCandidate[] = [
  { label: "1:1", ratio: 1, scoreBias: 0 },
  { label: "3:2", ratio: 3 / 2, scoreBias: 0 },
  { label: "2:3", ratio: 2 / 3, scoreBias: 0 },
  { label: "16:9", ratio: 16 / 9, scoreBias: 0 },
  { label: "9:16", ratio: 9 / 16, scoreBias: 0 },
  { label: "4:3", ratio: 4 / 3, scoreBias: 0 },
  { label: "3:4", ratio: 3 / 4, scoreBias: 0 },
  { label: "21:9", ratio: 21 / 9, scoreBias: 0 },
  { label: "9:21", ratio: 9 / 21, scoreBias: 0 },
];

export function formatImageRatioLabel(
  width?: number,
  height?: number,
  fallback?: string,
) {
  const roundedWidth = Math.round(width ?? 0);
  const roundedHeight = Math.round(height ?? 0);

  if (
    !Number.isFinite(roundedWidth) ||
    !Number.isFinite(roundedHeight) ||
    roundedWidth <= 0 ||
    roundedHeight <= 0
  ) {
    return fallback;
  }

  const actualRatio = roundedWidth / roundedHeight;
  const divisor = gcd(roundedWidth, roundedHeight);
  const simplifiedWidth = roundedWidth / divisor;
  const simplifiedHeight = roundedHeight / divisor;
  const simplified = `${simplifiedWidth}:${simplifiedHeight}`;

  if (COMMON_RATIOS.some((candidate) => candidate.label === simplified)) {
    return simplified;
  }

  const nearestCommon = findNearestRatio(actualRatio, COMMON_RATIOS);

  if (nearestCommon && nearestCommon.delta <= 0.015) {
    return `约 ${nearestCommon.label}`;
  }

  const nearestFriendly = findNearestRatio(
    actualRatio,
    createFriendlyRatioCandidates(),
  );

  if (nearestFriendly && nearestFriendly.delta <= 0.02) {
    return `约 ${nearestFriendly.label}`;
  }

  if (simplifiedWidth <= 99 && simplifiedHeight <= 99) {
    return simplified;
  }

  return `${roundedWidth}:${roundedHeight}`;
}

function findNearestRatio(ratio: number, candidates: RatioCandidate[]) {
  return candidates
    .map((candidate) => {
      const delta = Math.abs(ratio - candidate.ratio) / candidate.ratio;

      return {
        delta,
        label: candidate.label,
        score: delta + candidate.scoreBias,
      };
    })
    .sort((a, b) => a.score - b.score)[0];
}

function createFriendlyRatioCandidates() {
  const candidates: RatioCandidate[] = [];

  for (let width = 1; width <= 32; width += 1) {
    for (let height = 1; height <= 32; height += 1) {
      const divisor = gcd(width, height);

      if (divisor !== 1) {
        continue;
      }

      candidates.push({
        label: `${width}:${height}`,
        ratio: width / height,
        scoreBias: (width + height) * 0.001,
      });
    }
  }

  return candidates;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
