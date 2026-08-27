import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getLocalObjectUrl,
  verifyLocalObjectSignature,
  verifyLocalObjectUrl,
} from "./local";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("local object signatures", () => {
  it("keeps the signature verifiable after the public URL expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T00:00:00.000Z"));
    const key = "projects/project-1/shot.png";
    const url = new URL(getLocalObjectUrl(key, 60));
    const expires = Number(url.searchParams.get("expires"));
    const signature = url.searchParams.get("signature");

    expect(verifyLocalObjectUrl(key, String(expires), signature)).toBe(true);
    vi.setSystemTime(new Date("2026-08-27T00:02:00.000Z"));
    expect(verifyLocalObjectUrl(key, String(expires), signature)).toBe(false);
    expect(verifyLocalObjectSignature(key, expires, signature)).toBe(true);
    expect(verifyLocalObjectSignature(`${key}.forged`, expires, signature)).toBe(
      false,
    );
  });
});
