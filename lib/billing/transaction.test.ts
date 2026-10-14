import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { retryableBillingConflict } from "./transaction";
describe("wallet serialization conflicts", () => {
  it.each(["P2034", "P2002"])("retries %s", code => {
    expect(retryableBillingConflict(new Prisma.PrismaClientKnownRequestError("conflict", { code, clientVersion: "6" }))).toBe(true);
  });
  it("retries PostgreSQL raw-query conflicts without retrying real billing errors", () => {
    expect(retryableBillingConflict(new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2010", clientVersion: "6", meta: { code: "40001" } }))).toBe(true);
    expect(retryableBillingConflict(new Error("insufficient balance"))).toBe(false);
  });
});
