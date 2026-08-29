import { describe, expect, it } from "vitest";

import { extractManuscriptMetadata } from "./manuscript-metadata";

describe("manuscript metadata", () => {
  it("extracts title, author, and a multiline synopsis before the first volume", () => {
    const metadata = extractManuscriptMetadata(`
书名：《玄天战尊》
作者：无名
字数：1236万
简介：
震八荒扫六合，天地地下唯我独尊！
一雪前耻，成就无上玄天战尊！

第一卷
第1章 寒门少年
正文
`);

    expect(metadata).toEqual({
      title: "玄天战尊",
      author: "无名",
      synopsis:
        "震八荒扫六合，天地地下唯我独尊！\n一雪前耻，成就无上玄天战尊！",
    });
  });

  it("uses the file name when the source has no title header", () => {
    expect(extractManuscriptMetadata("第1章 开始", "故事.txt").title).toBe(
      "故事",
    );
  });
});
