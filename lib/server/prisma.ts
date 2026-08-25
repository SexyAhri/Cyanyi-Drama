import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export function isPrismaConfigured() {
  return Boolean(process.env.DATABASE_URL?.startsWith("mysql://"));
}

export async function assertPrismaConfigured() {
  if (!isPrismaConfigured())
    throw new Error(
      "DATABASE_URL must be configured with a MySQL connection string.",
    );
}
