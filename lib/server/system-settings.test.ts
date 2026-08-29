import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upsert: vi.fn() }));

vi.mock("./prisma", () => ({
  prisma: { systemSettings: { upsert: mocks.upsert } },
}));

import { getAdminSystemSettings } from "./system-settings";

describe("administrator system settings view", () => {
  it("reports configured secrets without returning encrypted values", async () => {
    mocks.upsert.mockResolvedValue({
      registrationEnabled: true,
      emailAuthEnabled: true,
      emailVerificationEnabled: true,
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      smtpSecure: true,
      smtpUsername: "mailer",
      smtpFrom: "mailer@example.com",
      smtpPasswordEncrypted: "smtp-ciphertext",
      githubEnabled: true,
      githubClientId: "github-id",
      githubClientSecretEncrypted: "github-ciphertext",
      linuxdoEnabled: true,
      linuxdoClientId: "linuxdo-id",
      linuxdoClientSecretEncrypted: "linuxdo-ciphertext",
      linuxdoMinimumTrustLevel: 2,
      epayEnabled: true,
      epayGatewayUrl: "https://pay.example.com",
      epayMerchantId: "merchant-id",
      epayMerchantKeyEncrypted: "epay-ciphertext",
      epayMethods: ["alipay"],
      epayMinimumAmount: new Prisma.Decimal(1),
      epayCreditRate: new Prisma.Decimal(1),
    });

    const settings = await getAdminSystemSettings();

    expect(settings).toMatchObject({
      smtpPasswordConfigured: true,
      githubClientSecretConfigured: true,
      linuxdoClientSecretConfigured: true,
      epayMerchantKeyConfigured: true,
    });
    expect(JSON.stringify(settings)).not.toContain("ciphertext");
  });
});
