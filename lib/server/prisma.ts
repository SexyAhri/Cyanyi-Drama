import { PrismaClient } from "@prisma/client";

const DEFAULT_DEVELOPMENT_DATABASE_URL =
  "postgresql://cyanyi:cyanyi@localhost:5432/cyanyi";

// Local Docker Compose provides these credentials. Production deployments must
// provide their own DATABASE_URL explicitly.
export function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== "production")
    return DEFAULT_DEVELOPMENT_DATABASE_URL;
  return undefined;
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: getDatabaseUrl(),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export function isPrismaConfigured() {
  return Boolean(
    process.env.DATABASE_URL?.startsWith("postgresql://") ||
      process.env.DATABASE_URL?.startsWith("postgres://"),
  );
}

export async function assertPrismaConfigured() {
  if (!isPrismaConfigured())
    throw new Error(
      "DATABASE_URL must be configured with a PostgreSQL connection string.",
    );
}
