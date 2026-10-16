import type { Prisma } from "@prisma/client";

import { prisma } from "./prisma";

export async function isInitialSetupRequired(
  db: Pick<Prisma.TransactionClient, "systemInstallation" | "user"> = prisma,
) {
  const installation = await db.systemInstallation.findUnique({
    where: { id: "global" },
    select: { id: true },
  });
  if (installation) return false;

  // Also protects accounts provisioned outside the setup endpoint.
  const existingAccount = await db.user.findFirst({
    where: { OR: [{ anonymous: false }, { role: "ADMIN" }] },
    select: { id: true },
  });
  return !existingAccount;
}

export async function assertInstallationInitialized() {
  if (await isInitialSetupRequired()) throw new Error("INITIAL_SETUP_REQUIRED");
}
