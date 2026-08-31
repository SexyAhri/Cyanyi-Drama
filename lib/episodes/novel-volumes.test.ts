import { describe, expect, it } from "vitest";

import {
  parseNovelStructure,
  parseVolumeSelection,
  selectNovelVolumes,
} from "./novel-volumes";

const SOURCE = [
  "书名：《测试小说》",
  "第一卷 风起",
  "第1章 初见",
  "第一章正文。",
  "第825章 妖兽群集",
  "第二章正文。",
  "第二卷 云涌",
  "第826章 重逢",
  "第三章正文。",
  "",
].join("\n");

describe("novel volume parsing", () => {
  it("detects volumes without mistaking chapter titles for volume headings", () => {
    const structure = parseNovelStructure(SOURCE);

    expect(structure.hasExplicitVolumes).toBe(true);
    expect(structure.totalChapters).toBe(3);
    expect(structure.volumes).toHaveLength(2);
    expect(structure.volumes.map((volume) => volume.title)).toEqual([
      "第一卷 风起",
      "第二卷 云涌",
    ]);
    expect(structure.volumes[0].chapters.map((chapter) => chapter.heading)).toEqual([
      "第1章 初见",
      "第825章 妖兽群集",
    ]);
  });

  it("keeps selected volume chapter boundaries continuous", () => {
    const structure = parseNovelStructure(SOURCE);
    const selected = selectNovelVolumes(SOURCE, structure.volumes, [2]);
    const selectedStructure = parseNovelStructure(selected);
    const chapters = selectedStructure.volumes.flatMap((volume) => volume.chapters);

    expect(selected).toContain("第二卷 云涌");
    expect(selected).not.toContain("第一卷 风起");
    expect(chapters).toHaveLength(1);
    expect(chapters[0].startIndex).toBe(0);
    expect(chapters[0].endIndex).toBe(selected.length);
  });

  it("supports lists, ranges, and all-volume selection", () => {
    expect(parseVolumeSelection("1, 3-4", 5)).toEqual([1, 3, 4]);
    expect(parseVolumeSelection("全部", 3)).toEqual([1, 2, 3]);
    expect(() => parseVolumeSelection("4", 3)).toThrow("1 到 3");
  });

  it("treats a chapter-only novel as one implicit volume", () => {
    const structure = parseNovelStructure("前言\n第1章 开始\n正文\n第2章 继续\n正文\n");

    expect(structure.hasExplicitVolumes).toBe(false);
    expect(structure.volumes).toHaveLength(1);
    expect(structure.volumes[0].title).toBe("未分卷");
    expect(structure.totalChapters).toBe(2);
  });
});
