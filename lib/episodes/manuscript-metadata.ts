export type ManuscriptMetadata = {
  title: string;
  author: string;
  synopsis: string;
};

const BODY_HEADING = /^(?:正文|目录|第[零〇一二两三四五六七八九十百千万\d]+[卷章节幕集])(?:\s|$)/u;

export function extractManuscriptMetadata(
  source: string,
  fileName?: string,
): ManuscriptMetadata {
  const sample = source.replace(/^\uFEFF/u, "").slice(0, 50_000);
  const lines = sample.split(/\r?\n/u).map((line) => line.trim());
  const title =
    captureHeader(lines, /^(?:书名|小说名|作品名)\s*[：:]\s*(.+)$/u) ||
    titleFromFileName(fileName) ||
    "未命名小说";
  const author = captureHeader(lines, /^作者\s*[：:]\s*(.+)$/u);
  const synopsis = captureSynopsis(lines);
  return {
    title: stripBookTitle(title),
    author,
    synopsis,
  };
}

function captureHeader(lines: string[], pattern: RegExp) {
  for (const line of lines.slice(0, 120)) {
    const match = pattern.exec(line);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

function captureSynopsis(lines: string[]) {
  const markerIndex = lines
    .slice(0, 160)
    .findIndex((line) => /^(?:内容)?简介\s*[：:]/u.test(line));
  if (markerIndex < 0) return "";
  const firstLine = lines[markerIndex]
    .replace(/^(?:内容)?简介\s*[：:]\s*/u, "")
    .trim();
  const output = firstLine ? [firstLine] : [];
  let started = Boolean(firstLine);
  for (const line of lines.slice(markerIndex + 1, markerIndex + 81)) {
    if (BODY_HEADING.test(line)) break;
    if (!line) {
      if (started && output.at(-1) !== "") output.push("");
      continue;
    }
    started = true;
    output.push(line);
  }
  return output.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function titleFromFileName(fileName?: string) {
  return fileName?.replace(/\.[^.]+$/u, "").trim() ?? "";
}

function stripBookTitle(value: string) {
  return value.replace(/^《|》$/gu, "").trim();
}
