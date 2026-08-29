import { describe, expect, it } from "vitest";

import {
  PROMPT_CANARY_MANIFEST,
  assertPromptCanaries,
  runPromptCanaries,
} from "./canary";

describe("prompt canary", () => {
  it("pins every bilingual prompt and its behavior contract", () => {
    expect(assertPromptCanaries()).toEqual({
      checked: 34,
      passed: true,
      issues: [],
    });
  });

  it("reports drift without making a provider request", () => {
    const report = runPromptCanaries({
      ...PROMPT_CANARY_MANIFEST,
      "episode_split:zh": "changed",
    });
    expect(report.passed).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        key: "episode_split:zh",
        code: "PROMPT_CANARY_HASH_MISMATCH",
      }),
    );
  });
});
