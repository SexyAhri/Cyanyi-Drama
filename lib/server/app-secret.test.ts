import { afterEach, describe, expect, it, vi } from "vitest";

import { getAppSecret } from "./app-secret";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAppSecret", () => {
  it("uses the compatible development fallback outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_SECRET", "");

    expect(getAppSecret()).toBe("cyanyi-development-secret");
  });

  it("requires an explicit secret in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_SECRET", "");

    expect(() => getAppSecret()).toThrow("APP_SECRET_REQUIRED");
  });

  it("rejects public development secrets in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_SECRET", "cyanyi-local-development");

    expect(() => getAppSecret()).toThrow("APP_SECRET_INSECURE");
  });

  it("accepts a configured production secret", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_SECRET", "production-secret-with-sufficient-entropy");

    expect(getAppSecret()).toBe("production-secret-with-sufficient-entropy");
  });
});
