import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authFlowCreate: vi.fn(),
  authFlowFindFirst: vi.fn(),
  authFlowUpdateMany: vi.fn(),
  getCurrentUser: vi.fn(),
  getOAuthProviderConfig: vi.fn(),
  loginWithExternalIdentity: vi.fn(),
}));

vi.mock("./auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  loginWithExternalIdentity: mocks.loginWithExternalIdentity,
}));

vi.mock("./prisma", () => ({
  prisma: {
    authFlow: {
      create: mocks.authFlowCreate,
      findFirst: mocks.authFlowFindFirst,
      updateMany: mocks.authFlowUpdateMany,
    },
  },
}));

vi.mock("./system-settings", () => ({
  getOAuthProviderConfig: mocks.getOAuthProviderConfig,
}));

import { beginOAuthFlow, completeOAuthFlow } from "./oauth";

describe("OAuth state lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.getOAuthProviderConfig.mockResolvedValue({
      clientId: "client-id",
      clientSecret: "client-secret",
      minimumTrustLevel: 0,
    });
    mocks.loginWithExternalIdentity.mockResolvedValue({
      user: { id: "user-1" },
      sessionId: "session-1",
    });
  });

  it("stores only a SHA-256 hash of the one-time state", async () => {
    const authorizeUrl = await beginOAuthFlow(
      "github",
      new Request("http://localhost/api/auth/oauth/github/start"),
      "/chat",
    );
    const state = new URL(authorizeUrl).searchParams.get("state");

    expect(state).toBeTruthy();
    expect(mocks.authFlowCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenHash: createHash("sha256").update(state!).digest("hex"),
      }),
    });
    expect(mocks.authFlowCreate.mock.calls[0]?.[0].data.tokenHash).not.toBe(
      state,
    );
  });

  it("atomically consumes state and rejects a replay", async () => {
    const flow = {
      id: "flow-1",
      anonymousUserId: null,
      redirectPath: "/chat",
    };
    mocks.authFlowFindFirst.mockResolvedValue(flow);
    mocks.authFlowUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("access_token")) {
        return Response.json({ access_token: "token" });
      }
      if (url.endsWith("/user")) {
        return Response.json({ id: 7, login: "creator", name: "Creator" });
      }
      return Response.json([
        { email: "unverified@example.com", primary: true, verified: false },
        { email: "verified@example.com", primary: false, verified: true },
      ]);
    }));

    const request = new Request(
      "http://localhost/api/auth/oauth/github/callback?state=state-1&code=code-1",
    );
    await expect(completeOAuthFlow("github", request)).resolves.toMatchObject({
      redirectPath: "/chat",
      sessionId: "session-1",
    });
    expect(mocks.loginWithExternalIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ email: "verified@example.com" }),
    );

    await expect(completeOAuthFlow("github", request)).rejects.toThrow(
      "OAUTH_STATE_INVALID",
    );
    expect(mocks.loginWithExternalIdentity).toHaveBeenCalledTimes(1);
  });
});
