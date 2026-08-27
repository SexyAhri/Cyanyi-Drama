import { afterEach, describe, expect, it, vi } from "vitest";

import { getStorageProvider } from "./index";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("storage provider selection", () => {
  it("defaults to durable local storage when no provider is selected", () => {
    vi.stubEnv("STORAGE_PROVIDER", "");
    expect(getStorageProvider()).toBe("local");
  });

  it("uses S3 only when it is selected explicitly", () => {
    vi.stubEnv("STORAGE_PROVIDER", "s3");
    expect(getStorageProvider()).toBe("s3");
  });
});
