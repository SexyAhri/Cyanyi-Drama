import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ installation: vi.fn(), user: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: {
  systemInstallation: { findUnique: mocks.installation },
  user: { findFirst: mocks.user },
} }));

import { assertInstallationInitialized, isInitialSetupRequired } from "./installation";
import { loginWithExternalIdentity, registerUser } from "./auth";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.installation.mockResolvedValue(null);
  mocks.user.mockResolvedValue(null);
});

describe("installation gate", () => {
  it("requires setup on an empty deployment", async () => {
    expect(await isInitialSetupRequired()).toBe(true);
    await expect(assertInstallationInitialized()).rejects.toThrow("INITIAL_SETUP_REQUIRED");
  });
  it("keeps setup closed after all accounts are removed", async () => {
    mocks.installation.mockResolvedValue({ id: "global" });
    expect(await isInitialSetupRequired()).toBe(false);
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("never exposes an admin claim on an existing installation", async () => {
    mocks.user.mockResolvedValue({ id: "existing-user" });
    expect(await isInitialSetupRequired()).toBe(false);
    expect(mocks.user).toHaveBeenCalledWith({
      where: { OR: [{ anonymous: false }, { role: "ADMIN" }] }, select: { id: true },
    });
  });
  it("blocks ordinary registration before administrator setup", async () => {
    await expect(registerUser("user@example.com", "test-password")).rejects.toThrow("INITIAL_SETUP_REQUIRED");
  });
  it("blocks OAuth registration before administrator setup", async () => {
    await expect(loginWithExternalIdentity({ provider: "github", providerUserId: "1" })).rejects.toThrow("INITIAL_SETUP_REQUIRED");
  });
});
