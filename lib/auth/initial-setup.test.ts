import { describe, expect, it } from "vitest";
import { initialAdminSchema } from "./initial-setup";

const valid = { displayName: "管理员", email: "admin@example.com", password: "test-password", confirmPassword: "test-password" };

describe("initial administrator input", () => {
  it("normalizes the name and email but preserves password bytes", () => {
    expect(initialAdminSchema.parse({ ...valid, displayName: " 管理员 ", email: " ADMIN@Example.com ", password: " password ", confirmPassword: " password " }))
      .toEqual({ ...valid, password: " password ", confirmPassword: " password " });
  });

  it.each([
    { displayName: " " }, { displayName: "a".repeat(81) },
    { email: "invalid" }, { email: 42 },
    { password: "short", confirmPassword: "short" },
    { password: " ".repeat(8), confirmPassword: " ".repeat(8) },
    { password: "a".repeat(129), confirmPassword: "a".repeat(129) },
    { confirmPassword: "different" }, { role: "ADMIN" },
  ])("rejects invalid or unexpected input: %j", (patch) => {
    expect(initialAdminSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});
