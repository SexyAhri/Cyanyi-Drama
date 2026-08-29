import { describe, expect, it } from "vitest";

import { joinManuscriptParts, mergeManuscriptParts } from "./manuscript-parts";

describe("multi-file manuscript import", () => {
  it("joins separately selected volumes in natural file-name order", () => {
    const parts = mergeManuscriptParts(
      [{ name: "003_第三卷.txt", text: "第三卷\r\n" }],
      [
        { name: "002_第二卷.txt", text: "第二卷\r\n" },
        { name: "001_第一卷.txt", text: "第一卷\r\n" },
      ],
    );

    expect(parts.map((part) => part.name)).toEqual([
      "001_第一卷.txt",
      "002_第二卷.txt",
      "003_第三卷.txt",
    ]);
    expect(joinManuscriptParts(parts)).toBe("第一卷\r\n第二卷\r\n第三卷\r\n");
  });

  it("adds one separator only when independently prepared parts lack line endings", () => {
    expect(
      joinManuscriptParts([
        { name: "001.txt", text: "第一卷" },
        { name: "002.txt", text: "第二卷" },
      ]),
    ).toBe("第一卷\n第二卷");
  });
});
