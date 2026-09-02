import { describe, expect, it } from "vitest";

import {
  characterAnalysisSchema,
  locationPropAnalysisSchema,
} from "./schemas";

describe("permissive asset analysis schemas", () => {
  it("accepts useful character data without evidence metadata", () => {
    expect(
      characterAnalysisSchema.parse({
        characters: [{ name: "韩宇", role: "主角" }],
        explanation: "ignored provider metadata",
      }),
    ).toEqual({
      characters: [
        {
          name: "韩宇",
          aliases: [],
          profile: {},
          evidence: [],
        },
      ],
    });
  });

  it("accepts locations and props without evidence metadata", () => {
    expect(
      locationPropAnalysisSchema.parse({
        locations: [{ name: "练武场" }],
        props: [{ name: "无字古籍", color: "玄色" }],
      }),
    ).toEqual({
      locations: [{ name: "练武场", evidence: [] }],
      props: [{ name: "无字古籍", evidence: [] }],
    });
  });
});
