import { describe, expect, it } from "vitest";

import {
  validateAdaptationSummary,
  validateSourceEvidence,
} from "./adaptation";

describe("episode adaptation evidence", () => {
  it("accepts only verbatim excerpts from the original source", () => {
    const source = "韩风推开木门，看见桌上放着一封未拆的信。";

    expect(validateSourceEvidence(["推开木门", "一封未拆的信"], source)).toEqual([]);
    expect(validateSourceEvidence(["推开房门"], source)).toEqual([
      {
        code: "SOURCE_EVIDENCE_NOT_FOUND",
        path: "sourceEvidence.0",
        message: "sourceEvidence must be copied verbatim from source_text",
      },
    ]);
  });
});

describe("episode adaptation summary", () => {
  it("rejects a shallow opening excerpt and accepts a complete plot synopsis", () => {
    const source = "少年遭遇追杀。".repeat(200);

    expect(validateAdaptationSummary("少年遭遇追杀。", source)).toEqual([
      {
        code: "EPISODE_SUMMARY_TOO_SHALLOW",
        path: "summary",
        message:
          "summary must be regenerated from the complete source and cover setup, conflict, turning point, and ending state",
      },
    ]);
    expect(
      validateAdaptationSummary(
        "少年在归途中遭遇妖狼追杀，被迫利用山势周旋；危急时刻他发现妖狼受伤的弱点，改变逃跑路线并设下反击。经过正面冲突，他成功击退妖狼，也意识到幕后仍有人操控这次袭击，最终带着新的线索继续赶路。",
        source,
      ),
    ).toEqual([]);
  });
});
