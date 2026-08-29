import { afterEach, describe, expect, it, vi } from "vitest";

import {
  codesMatch,
  emailVerificationWaitSeconds,
  hashEmailVerificationCode,
  isValidEmail,
  normalizeEmail,
  registrationVerificationStatus,
} from "./email-verification";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("email verification", () => {
  it("normalizes and validates an email address", () => {
    expect(normalizeEmail("  Creator@Example.COM ")).toBe(
      "creator@example.com",
    );
    expect(isValidEmail("creator@example.com")).toBe(true);
    expect(isValidEmail("creator@example")).toBe(false);
  });

  it("binds a code hash to both the code and normalized email", () => {
    vi.stubEnv("APP_SECRET", "email-verification-test-secret");
    const hash = hashEmailVerificationCode("Creator@Example.com", "123456");

    expect(
      codesMatch(
        hash,
        hashEmailVerificationCode("creator@example.com", "123456"),
      ),
    ).toBe(true);
    expect(
      codesMatch(
        hash,
        hashEmailVerificationCode("other@example.com", "123456"),
      ),
    ).toBe(false);
    expect(
      codesMatch(
        hash,
        hashEmailVerificationCode("creator@example.com", "654321"),
      ),
    ).toBe(false);
  });

  it("enforces the resend interval", () => {
    const now = new Date("2026-08-29T12:00:00.000Z");
    expect(
      emailVerificationWaitSeconds(new Date("2026-08-29T11:59:31.000Z"), now),
    ).toBe(31);
    expect(
      emailVerificationWaitSeconds(new Date("2026-08-29T11:58:59.000Z"), now),
    ).toBe(0);
  });

  it("rejects expired, consumed, and locked codes", () => {
    vi.stubEnv("APP_SECRET", "email-verification-test-secret");
    const now = new Date("2026-08-29T12:00:00.000Z");
    const record = {
      attemptCount: 0,
      codeHash: hashEmailVerificationCode("creator@example.com", "123456"),
      consumedAt: null,
      expiresAt: new Date("2026-08-29T12:10:00.000Z"),
    };

    expect(
      registrationVerificationStatus(
        record,
        "creator@example.com",
        "123456",
        now,
      ),
    ).toBe("valid");
    expect(
      registrationVerificationStatus(
        record,
        "creator@example.com",
        "000000",
        now,
      ),
    ).toBe("invalid");
    expect(
      registrationVerificationStatus(
        { ...record, expiresAt: now },
        "creator@example.com",
        "123456",
        now,
      ),
    ).toBe("unavailable");
    expect(
      registrationVerificationStatus(
        { ...record, consumedAt: now },
        "creator@example.com",
        "123456",
        now,
      ),
    ).toBe("unavailable");
    expect(
      registrationVerificationStatus(
        { ...record, attemptCount: 5 },
        "creator@example.com",
        "123456",
        now,
      ),
    ).toBe("unavailable");
  });
});
