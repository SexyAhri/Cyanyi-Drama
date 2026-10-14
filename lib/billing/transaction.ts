import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";

/** PostgreSQL reports serialization conflicts both as P2034 and raw-query P2010/40001. */
export function retryableBillingConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return ["P2034", "P2002"].includes(error.code)
    || (error.code === "P2010" && ["40001", "40P01"].includes(String(error.meta?.code)));
}

export async function billingTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(run, { ...options, isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      if (attempt >= 5 || !retryableBillingConflict(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 10));
    }
  }
}
