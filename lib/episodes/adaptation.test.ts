import { describe, expect, it } from "vitest";

import { validateSourceEvidence } from "./adaptation";

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
