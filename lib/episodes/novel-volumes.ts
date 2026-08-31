const CHINESE_NUMBER = "零〇一二两三四五六七八九十百千万萬亿億0-9０-９";
const VOLUME_HEADING = new RegExp(
  `^第([${CHINESE_NUMBER}]+)([卷部篇集])(?:[：:\\s]+(.+))?$`,
  "u",
);
const CHAPTER_HEADING = new RegExp(
  `^第([${CHINESE_NUMBER}]+)([章回节])(?:[：:\\s]+(.+))?$`,
  "u",
);

export type NovelChapter = {
  heading: string;
  title: string;
  sourceNumber: number | null;
  startIndex: number;
  endIndex: number;
};

export type NovelVolume = {
  index: number;
  title: string;
  startIndex: number;
  endIndex: number;
  chapters: NovelChapter[];
};

export type NovelStructure = {
  hasExplicitVolumes: boolean;
  totalChapters: number;
  volumes: NovelVolume[];
};

export function parseNovelStructure(source: string): NovelStructure {
  const volumes: NovelVolume[] = [];
  let currentVolume: NovelVolume | null = null;
  let lastChapter: NovelChapter | null = null;
  let hasExplicitVolumes = false;

  visitLines(source, (rawLine, lineStart) => {
    const line = rawLine.trim();
    const volumeMatch = VOLUME_HEADING.exec(line);
    if (volumeMatch) {
      hasExplicitVolumes = true;
      if (lastChapter) lastChapter.endIndex = lineStart;
      if (currentVolume) currentVolume.endIndex = lineStart;
      currentVolume = {
        index: volumes.length + 1,
        title: line,
        startIndex: lineStart,
        endIndex: source.length,
        chapters: [],
      };
      volumes.push(currentVolume);
      lastChapter = null;
      return;
    }

    const chapterMatch = CHAPTER_HEADING.exec(line);
    if (!chapterMatch) return;
    if (!currentVolume) {
      currentVolume = {
        index: volumes.length + 1,
        title: "未分卷",
        startIndex: 0,
        endIndex: source.length,
        chapters: [],
      };
      volumes.push(currentVolume);
    }
    if (lastChapter) lastChapter.endIndex = lineStart;
    const chapter: NovelChapter = {
      heading: line,
      title: chapterMatch[3]?.trim() || line,
      sourceNumber: parseChineseNumber(chapterMatch[1]),
      startIndex:
        currentVolume.chapters.length === 0
          ? currentVolume.startIndex
          : lineStart,
      endIndex: source.length,
    };
    currentVolume.chapters.push(chapter);
    lastChapter = chapter;
  });

  const finalVolume = volumes.at(-1);
  const finalChapter = finalVolume?.chapters.at(-1);
  if (finalChapter) finalChapter.endIndex = source.length;
  if (finalVolume) finalVolume.endIndex = source.length;
  return {
    hasExplicitVolumes,
    totalChapters: volumes.reduce(
      (total, volume) => total + volume.chapters.length,
      0,
    ),
    volumes,
  };
}

export function parseVolumeSelection(value: string, volumeCount: number) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) throw new Error("请选择至少一卷");
  if (normalized === "all" || normalized === "全部") {
    return Array.from({ length: volumeCount }, (_, index) => index + 1);
  }

  const selected = new Set<number>();
  for (const token of normalized.split(/[，,]/u)) {
    const part = token.trim();
    const range = /^(\d+)\s*[-~至]\s*(\d+)$/u.exec(part);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > end) throw new Error(`卷范围无效：${part}`);
      for (let index = start; index <= end; index += 1) selected.add(index);
      continue;
    }
    if (!/^\d+$/u.test(part)) throw new Error(`无法识别卷选择：${part}`);
    selected.add(Number(part));
  }

  const output = [...selected].sort((left, right) => left - right);
  if (!output.length || output.some((index) => index < 1 || index > volumeCount))
    throw new Error(`卷编号必须在 1 到 ${volumeCount} 之间`);
  return output;
}

export function selectNovelVolumes(
  source: string,
  volumes: NovelVolume[],
  selectedIndices: number[],
) {
  const selected = selectedIndices.map((index) => {
    const volume = volumes[index - 1];
    if (!volume) throw new Error(`第 ${index} 卷不存在`);
    return source.slice(volume.startIndex, volume.endIndex).trim();
  });
  return `${selected.join("\n\n")}\n`;
}

function visitLines(
  source: string,
  visitor: (line: string, startIndex: number) => void,
) {
  let startIndex = 0;
  while (startIndex <= source.length) {
    const newlineIndex = source.indexOf("\n", startIndex);
    const endIndex = newlineIndex < 0 ? source.length : newlineIndex;
    const line = source
      .slice(startIndex, endIndex)
      .replace(/\r$/u, "");
    visitor(line, startIndex);
    if (newlineIndex < 0) break;
    startIndex = newlineIndex + 1;
  }
}

function parseChineseNumber(value: string) {
  const normalizedDigits = value.replace(/[０-９]/gu, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
  );
  if (/^\d+$/u.test(normalizedDigits)) return Number(normalizedDigits);

  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const smallUnits: Record<string, number> = { 十: 10, 百: 100, 千: 1_000 };
  const largeUnits: Record<string, number> = {
    万: 10_000,
    萬: 10_000,
    亿: 100_000_000,
    億: 100_000_000,
  };
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const character of normalizedDigits) {
    if (character in digits) {
      digit = digits[character];
    } else if (character in smallUnits) {
      section += (digit || 1) * smallUnits[character];
      digit = 0;
    } else if (character in largeUnits) {
      total += (section + digit) * largeUnits[character];
      section = 0;
      digit = 0;
    } else {
      return null;
    }
  }
  return total + section + digit;
}
