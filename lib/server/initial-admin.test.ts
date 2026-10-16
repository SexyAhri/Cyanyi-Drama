import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  installation: vi.fn(), existingUser: vi.fn(), claim: vi.fn(), createUser: vi.fn(),
  hash: vi.fn(), session: vi.fn(), transaction: vi.fn(),
}));
vi.mock("./prisma", () => ({ prisma: {
  systemInstallation: { findUnique: mocks.installation },
  user: { findFirst: mocks.existingUser },
  $transaction: mocks.transaction,
} }));
vi.mock("./crypto", () => ({ hashPassword: mocks.hash }));
vi.mock("./auth", () => ({ createSession: mocks.session }));

import { initializeAdmin } from "./initial-admin";
const valid = { displayName: "管理员", email: "ADMIN@Example.com", password: "test-password", confirmPassword: "test-password" };
const tx = {
  systemInstallation: { findUnique: mocks.installation, create: mocks.claim },
  user: { findFirst: mocks.existingUser, create: mocks.createUser },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.installation.mockResolvedValue(null);
  mocks.existingUser.mockResolvedValue(null);
  mocks.hash.mockResolvedValue("salt:hash");
  mocks.createUser.mockResolvedValue({ id: "admin", role: "ADMIN" });
  mocks.session.mockResolvedValue("session-token");
  mocks.transaction.mockImplementation(async (fn) => fn(tx));
});

describe("initial administrator creation", () => {
  it("claims setup, creates an explicit admin and session in one transaction", async () => {
    expect(await initializeAdmin(valid)).toEqual({ user: { id: "admin", role: "ADMIN" }, sessionId: "session-token" });
    expect(mocks.claim).toHaveBeenCalledWith({ data: { id: "global" } });
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({
      data: { displayName: "管理员", email: "admin@example.com", passwordHash: "salt:hash", anonymous: false, role: "ADMIN" },
    }));
    expect(mocks.session).toHaveBeenCalledWith(tx, "admin");
  });
  it("rejects a completed setup before hashing or creating anything", async () => {
    mocks.installation.mockResolvedValue({ id: "global" });
    await expect(initializeAdmin(valid)).rejects.toThrow("INITIAL_SETUP_COMPLETED");
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rechecks setup inside the transaction", async () => {
    mocks.installation.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "global" });
    await expect(initializeAdmin(valid)).rejects.toThrow("INITIAL_SETUP_COMPLETED");
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("maps a competing singleton claim to setup completed", async () => {
    mocks.claim.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "6.19.2" }));
    await expect(initializeAdmin(valid)).rejects.toThrow("INITIAL_SETUP_COMPLETED");
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("propagates session errors so the transaction rolls back", async () => {
    mocks.session.mockRejectedValue(new Error("session write failed"));
    await expect(initializeAdmin(valid)).rejects.toThrow("session write failed");
  });
  it("validates the server boundary before touching the database", async () => {
    await expect(initializeAdmin({ ...valid, role: "USER" })).rejects.toThrow();
    expect(mocks.installation).not.toHaveBeenCalled();
  });
});
