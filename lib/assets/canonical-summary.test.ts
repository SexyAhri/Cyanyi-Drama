import { describe, expect, it } from "vitest";

import {
  canonicalSummaryPlaceholderFragments,
  mergeCanonicalSummary,
  sanitizeCanonicalSummary,
} from "./canonical-summary";

describe("canonical asset summaries", () => {
  it("removes template padding while preserving source-backed facts", () => {
    const summary =
      "空间尺度为边陲小镇，地貌层级为无具体描述，建筑关系为无，天地能量/科技规律为无，静态概述：无";

    expect(sanitizeCanonicalSummary(summary)).toBe("空间尺度为边陲小镇");
    expect(canonicalSummaryPlaceholderFragments(summary)).toEqual([
      "地貌层级为无具体描述",
      "建筑关系为无",
      "天地能量/科技规律为无",
      "静态概述：无",
    ]);
  });

  it("merges stable facts across episodes without duplication", () => {
    const first = "太炎镇坐落于大秦王朝西部边陲；边陲小镇";
    const second = "边陲小镇；隶属景阳城辖境";

    expect(mergeCanonicalSummary(first, second)).toBe(
      "太炎镇坐落于大秦王朝西部边陲；边陲小镇；隶属景阳城辖境",
    );
  });

  it("does not erase established facts with null or placeholder output", () => {
    expect(mergeCanonicalSummary("百年家族庄院", null)).toBe(
      "百年家族庄院",
    );
    expect(mergeCanonicalSummary("百年家族庄院", "原文未描述")).toBe(
      "百年家族庄院",
    );
  });
});
