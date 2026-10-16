import { Prisma } from "@prisma/client";

import { initialAdminSchema } from "@/lib/auth/initial-setup";
import { createSession } from "./auth";
import { hashPassword } from "./crypto";
import { isInitialSetupRequired } from "./installation";
import { prisma } from "./prisma";

export async function initializeAdmin(input: unknown) {
  const data = initialAdminSchema.parse(input);
  if (!(await isInitialSetupRequired())) throw new Error("INITIAL_SETUP_COMPLETED");
  const passwordHash = await hashPassword(data.password);

  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await isInitialSetupRequired(tx))) throw new Error("INITIAL_SETUP_COMPLETED");

      // The singleton primary key serializes competing setup requests. A failed
      // account/session write rolls this claim back together with the account.
      await tx.systemInstallation.create({ data: { id: "global" } });
      const user = await tx.user.create({
        data: {
          displayName: data.displayName,
          email: data.email,
          passwordHash,
          anonymous: false,
          role: "ADMIN",
        },
        select: { id: true, displayName: true, email: true, anonymous: true, role: true },
      });
      const sessionId = await createSession(tx, user.id);
      return { user, sessionId };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("INITIAL_SETUP_COMPLETED");
    }
    throw error;
  }
}
