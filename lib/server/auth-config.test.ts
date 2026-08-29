import { afterEach, describe, expect, it, vi } from "vitest";

import { getEmailSmtpConfig, getPublicAuthConfig } from "./auth-config";

vi.mock("./prisma", () => ({
  prisma: {
    systemSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth configuration", () => {
  it("keeps email verification opt-in", async () => {
    vi.stubEnv("EMAIL_VERIFICATION_ENABLED", "");
    expect((await getPublicAuthConfig()).emailVerificationEnabled).toBe(false);

    vi.stubEnv("EMAIL_VERIFICATION_ENABLED", "TRUE");
    expect((await getPublicAuthConfig()).emailVerificationEnabled).toBe(true);
  });

  it("requires a host and sender before creating SMTP configuration", async () => {
    vi.stubEnv("EMAIL_SMTP_HOST", "");
    vi.stubEnv("EMAIL_FROM", "");
    vi.stubEnv("EMAIL_SMTP_USER", "");
    await expect(getEmailSmtpConfig()).rejects.toThrow(
      "EMAIL_SERVICE_NOT_CONFIGURED",
    );
  });

  it("builds authenticated SMTP configuration", async () => {
    vi.stubEnv("EMAIL_SMTP_HOST", "smtp.example.com");
    vi.stubEnv("EMAIL_SMTP_PORT", "587");
    vi.stubEnv("EMAIL_SMTP_SECURE", "false");
    vi.stubEnv("EMAIL_SMTP_USER", "mailer@example.com");
    vi.stubEnv("EMAIL_SMTP_PASSWORD", "secret");
    vi.stubEnv("EMAIL_FROM", "noreply@example.com");

    await expect(getEmailSmtpConfig()).resolves.toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      from: "noreply@example.com",
      auth: { user: "mailer@example.com", pass: "secret" },
    });
  });
});
