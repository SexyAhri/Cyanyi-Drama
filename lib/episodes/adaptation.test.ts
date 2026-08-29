import { describe, expect, it } from "vitest";

import {
  buildSourceEvidenceCandidates,
  createJsonStringFieldStream,
  extractPartialJsonStringField,
  validateAdaptationSummary,
  validateSourceEvidence,
} from "./adaptation";

describe("episode adaptation streaming preview", () => {
  it("extracts a JSON string field before the response is complete", () => {
    expect(
      extractPartialJsonStringField(
        '{"title":"第一集","summary":"完整梗概","adaptedText":"第一段\\n第二段',
        "adaptedText",
      ),
    ).toBe("第一段\n第二段");
    expect(
      extractPartialJsonStringField(
        '{"title":"第一集","summary":"尚未完成',
        "adaptedText",
      ),
    ).toBeNull();
  });

  it("waits for a complete unicode escape instead of showing broken text", () => {
    expect(
      extractPartialJsonStringField(
        '{"adaptedText":"开场\\u4e2',
        "adaptedText",
      ),
    ).toBe("开场");
    expect(
      extractPartialJsonStringField(
        '{"adaptedText":"开场\\u4e2d',
        "adaptedText",
      ),
    ).toBe("开场中");
  });

  it("emits only new adapted text across model chunks", () => {
    const stream = createJsonStringFieldStream("adaptedText");

    expect(stream.push('{"title":"第一集","adapted')).toBe("");
    expect(stream.push('Text":"第一段\\n第')).toBe("第一段\n第");
    expect(stream.push('二段\\u4e2')).toBe("二段");
    expect(stream.push('d","changeSummary":[]}')).toBe("中");
  });
});

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

  it("offers exact evidence candidates across the complete source", () => {
    const source = [
      "开场时韩宇在寒夜练武，凭苦修举起沉重铁石。",
      "回家后他发现受伤的父亲仍在准备晚饭。",
      "父亲取出母亲留下的无字典籍并交给韩宇。",
      "韩宇得知母亲仍然在世，却必须达到阴阳之境才有希望相见。",
    ].join("\n");
    const candidates = buildSourceEvidenceCandidates(source);

    expect(candidates.length).toBe(4);
    expect(candidates.every((quote) => source.includes(quote))).toBe(true);
    expect(candidates[0]).toContain("寒夜练武");
    expect(candidates.at(-1)).toContain("阴阳之境");
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
