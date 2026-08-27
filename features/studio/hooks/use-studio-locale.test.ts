import { describe, expect, it } from "vitest";

import { normalizeStudioLocale } from "./use-studio-locale";

describe("studio locale", () => {
  it("accepts English and defaults every other persisted value to Chinese", () => {
    expect(normalizeStudioLocale("en")).toBe("en");
    expect(normalizeStudioLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeStudioLocale(null)).toBe("zh-CN");
    expect(normalizeStudioLocale("invalid")).toBe("zh-CN");
  });
});
