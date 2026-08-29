import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachSessionCookie: vi.fn((response: Response) => response),
  channelFindMany: vi.fn(),
  ensureAnonymousUser: vi.fn(),
  requireAdmin: vi.fn(),
  transaction: vi.fn(),
  txChannelFindFirst: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => {
  class AdminRequiredError extends Error {}
  return {
    AdminRequiredError,
    attachSessionCookie: mocks.attachSessionCookie,
    ensureAnonymousUser: mocks.ensureAnonymousUser,
    requireAdmin: mocks.requireAdmin,
  };
});

vi.mock("@/lib/server/crypto", () => ({
  decryptSecret: vi.fn(() => JSON.stringify(["secret-1", "secret-2"])),
  encryptSecret: vi.fn((value: string) => `encrypted:${value}`),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    channel: { findMany: mocks.channelFindMany },
  },
}));

import { AdminRequiredError } from "@/lib/server/auth";
import { GET, PUT } from "./route";

describe("channel administration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureAnonymousUser.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
      sessionId: null,
    });
    mocks.requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    mocks.transaction.mockImplementation((callback) =>
      callback({
        channel: { findFirst: mocks.txChannelFindFirst },
        providerModel: {},
      }),
    );
  });

  it("never returns plaintext API keys, including to administrators", async () => {
    mocks.channelFindMany.mockResolvedValue([
      {
        id: "channel-1",
        name: "System channel",
        providerKey: "custom",
        protocol: "openai-compatible",
        baseUrl: "https://upstream.example.com/v1",
        encryptedApiKeys: "ciphertext",
        models: [],
      },
    ]);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.channels[0]).toMatchObject({
      apiKeys: [],
      apiKeyCount: 2,
      baseUrl: "https://upstream.example.com/v1",
    });
    expect(JSON.stringify(payload)).not.toContain("secret-1");
  });

  it("rejects channel management for non-administrators", async () => {
    mocks.requireAdmin.mockRejectedValue(new AdminRequiredError());

    const response = await PUT(
      new Request("http://localhost/api/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns 400 when a new channel has no API key", async () => {
    mocks.txChannelFindFirst.mockResolvedValue(null);

    const response = await PUT(
      new Request("http://localhost/api/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New channel",
          protocol: "openai-compatible",
          baseUrl: "https://upstream.example.com/v1",
          apiKeys: [],
          models: [],
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      message: "新建渠道时至少需要一个 API Key",
    });
    expect(response.status).toBe(400);
  });
});
