import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  generateStructuredOutput,
  parseStructuredOutput,
  StructuredOutputError,
} from "./structured-output";

const schema = z.object({ value: z.number().int().positive() }).strict();

describe("structured output", () => {
  it("parses fenced JSON", () => {
    expect(parseStructuredOutput('```json\n{"value":1}\n```', schema)).toEqual({
      data: { value: 1 },
      repaired: false,
    });
  });

  it("extracts JSON from explanatory text", () => {
    expect(
      parseStructuredOutput('Result follows: {"value":2} done.', schema),
    ).toEqual({ data: { value: 2 }, repaired: false });
  });

  it("repairs malformed JSON before validation", () => {
    expect(parseStructuredOutput("{value: 3,}", schema)).toEqual({
      data: { value: 3 },
      repaired: true,
    });
  });

  it("requests one correction after semantic validation fails", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce('{"value":"invalid"}')
      .mockResolvedValueOnce('{"value":4}');

    const result = await generateStructuredOutput({
      schema,
      prompt: "Return JSON",
      request,
    });

    expect(result.data).toEqual({ value: 4 });
    expect(result.correctionAttempts).toBe(1);
    expect(request).toHaveBeenCalledTimes(2);
    const correctionMessages = request.mock.calls[1][0];
    expect(correctionMessages[2].content).toContain("value");
    expect(correctionMessages[2].content).toContain("corrected JSON only");
  });

  it("throws after the correction response still violates the schema", async () => {
    const request = vi.fn().mockResolvedValue('{"value":0}');

    await expect(
      generateStructuredOutput({
        schema,
        prompt: "Return JSON",
        request,
      }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
