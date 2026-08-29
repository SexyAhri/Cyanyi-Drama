import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { UserRole } from "@prisma/client";

import { getDatabaseUrl, prisma } from "./prisma";
import { hashPassword, verifyPassword } from "./crypto";
import {
  consumeRegistrationCode,
  isValidEmail,
  normalizeEmail,
  verifyRegistrationCode,
} from "./email-verification";
import { getPublicAuthConfig } from "./auth-config";

export const SESSION_COOKIE = "cyanyi_session";
const SESSION_DAYS = 30;

export type AuthUser = {
  id: string;
  email: string | null;
  displayName: string;
  anonymous: boolean;
  role: UserRole;
};

export class AdminRequiredError extends Error {
  constructor() {
    super("ADMIN_REQUIRED");
  }
}

export async function getCurrentUser() {
  await ensureDatabaseConfigured();
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  const session = await prisma.session.findFirst({
    where: { id: sessionId, expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  return session ? toAuthUser(session.user) : null;
}

export async function ensureAnonymousUser() {
  await ensureDatabaseConfigured();
  const existing = await getCurrentUser();
  if (existing) return { user: existing, sessionId: null };
  const now = new Date();
  const userId = randomUUID();
  const sessionId = randomUUID();
  await prisma.$transaction([
    prisma.user.create({
      data: { id: userId, displayName: "本地用户", anonymous: true },
    }),
    prisma.session.create({
      data: {
        id: sessionId,
        userId,
        expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000),
      },
    }),
  ]);
  return {
    user: {
      id: userId,
      email: null,
      displayName: "本地用户",
      anonymous: true,
      role: "USER" as const,
    },
    sessionId,
  };
}

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.anonymous || user.role !== "ADMIN") {
    throw new AdminRequiredError();
  }
  return user;
}

async function ensureDatabaseConfigured() {
  if (!getDatabaseUrl())
    throw new Error(
      "DATABASE_URL must be configured with a PostgreSQL connection string.",
    );
}

export function attachSessionCookie(
  response: Response,
  sessionId: string | null,
) {
  if (sessionId)
    response.headers.append("Set-Cookie", sessionCookie(sessionId));
  return response;
}

export function clearSessionCookie(response: Response) {
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookieSuffix()}`,
  );
  return response;
}

export async function registerUser(
  email: string,
  password: string,
  displayName?: string,
  verificationCode = "",
) {
  const authConfig = await getPublicAuthConfig();
  if (!authConfig.registrationEnabled) throw new Error("REGISTRATION_DISABLED");
  if (!authConfig.emailAuthEnabled) throw new Error("EMAIL_AUTH_DISABLED");
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) throw new Error("INVALID_EMAIL");
  if (password.length < 8) throw new Error("PASSWORD_TOO_SHORT");
  if (await prisma.user.findUnique({ where: { email: normalizedEmail } }))
    throw new Error("EMAIL_ALREADY_REGISTERED");

  const verificationId = await verifyRegistrationCode(
    normalizedEmail,
    verificationCode,
  );
  const previousUser = await getCurrentUser();
  try {
    return await prisma.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { email: normalizedEmail } })) {
        throw new Error("EMAIL_ALREADY_REGISTERED");
      }
      await consumeRegistrationCode(tx, verificationId);

      const user = await tx.user.create({
        data: {
          id: randomUUID(),
          email: normalizedEmail,
          emailVerifiedAt: verificationId ? new Date() : null,
          passwordHash: hashPassword(password),
          displayName: displayName?.trim() || normalizedEmail.split("@")[0],
          anonymous: false,
        },
      });
      if (previousUser?.anonymous) {
        await migrateAnonymousOwnership(tx, previousUser.id, user.id);
      }
      const sessionId = await createSession(tx, user.id);
      return { user: toAuthUser(user), sessionId };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new Error("EMAIL_ALREADY_REGISTERED");
    }
    throw error;
  }
}

export async function loginUser(email: string, password: string) {
  if (!(await getPublicAuthConfig()).emailAuthEnabled) {
    throw new Error("EMAIL_AUTH_DISABLED");
  }
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  });
  if (!user?.passwordHash || !verifyPassword(password, user.passwordHash))
    throw new Error("INVALID_CREDENTIALS");
  return { user: toAuthUser(user), sessionId: await createSession(prisma, user.id) };
}

export async function loginWithExternalIdentity(input: {
  provider: "github" | "linuxdo";
  providerUserId: string;
  username?: string;
  displayName?: string;
  email?: string;
  profile?: Record<string, unknown>;
  previousAnonymousUserId?: string;
}) {
  const normalizedEmail = input.email ? normalizeEmail(input.email) : null;
  const config = await getPublicAuthConfig();
  return prisma.$transaction(
    async (tx) => {
      const existingIdentity = await tx.externalIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: input.provider,
            providerUserId: input.providerUserId,
          },
        },
        include: { user: true },
      });

      let user = existingIdentity?.user ?? null;
      if (!user && normalizedEmail) {
        user = await tx.user.findUnique({ where: { email: normalizedEmail } });
      }
      if (!user) {
        if (!config.registrationEnabled) throw new Error("REGISTRATION_DISABLED");
        user = await tx.user.create({
          data: {
            id: randomUUID(),
            email: normalizedEmail,
            emailVerifiedAt: normalizedEmail ? new Date() : null,
            displayName:
              input.displayName?.trim() ||
              input.username?.trim() ||
              `${input.provider} 用户`,
            anonymous: false,
          },
        });
      }

      if (!existingIdentity) {
        const userBinding = await tx.externalIdentity.findUnique({
          where: { userId_provider: { userId: user.id, provider: input.provider } },
        });
        if (userBinding && userBinding.providerUserId !== input.providerUserId) {
          throw new Error("OAUTH_PROVIDER_ALREADY_BOUND");
        }
        await tx.externalIdentity.upsert({
          where: {
            provider_providerUserId: {
              provider: input.provider,
              providerUserId: input.providerUserId,
            },
          },
          create: {
            userId: user.id,
            provider: input.provider,
            providerUserId: input.providerUserId,
            username: input.username?.trim() || null,
            profileJson: toJsonValue(input.profile),
          },
          update: {
            username: input.username?.trim() || null,
            profileJson: toJsonValue(input.profile),
          },
        });
      } else {
        await tx.externalIdentity.update({
          where: { id: existingIdentity.id },
          data: {
            username: input.username?.trim() || existingIdentity.username,
            profileJson: toJsonValue(input.profile),
          },
        });
      }

      if (
        input.previousAnonymousUserId &&
        input.previousAnonymousUserId !== user.id
      ) {
        const previous = await tx.user.findFirst({
          where: { id: input.previousAnonymousUserId, anonymous: true },
        });
        if (previous) {
          await migrateAnonymousOwnership(tx, previous.id, user.id);
        }
      }
      return {
        user: toAuthUser(user),
        sessionId: await createSession(tx, user.id),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function destroyCurrentSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (sessionId) await prisma.session.deleteMany({ where: { id: sessionId } });
}

async function createSession(
  tx: Prisma.TransactionClient | typeof prisma,
  userId: string,
) {
  const id = randomUUID();
  await tx.session.create({
    data: {
      id,
      userId,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
    },
  });
  return id;
}

async function migrateAnonymousOwnership(
  tx: Prisma.TransactionClient,
  previousUserId: string,
  userId: string,
) {
  await tx.channel.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.project.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.mediaTask.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.workflowRun.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.productionDeliverable.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.productionDeliverable.updateMany({
    where: { approvedByUserId: previousUserId },
    data: { approvedByUserId: userId },
  });
  await tx.productionApprovalGate.updateMany({
    where: { decidedByUserId: previousUserId },
    data: { decidedByUserId: userId },
  });
  await tx.voicePreset.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.globalAssetFolder.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.globalCharacter.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.globalLocation.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.globalVoice.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.userBalance.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.balanceFreeze.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.balanceTransaction.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.usageCost.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.paymentOrder.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.userRuntimeSettings.updateMany({
    where: { userId: previousUserId },
    data: { userId },
  });
  await tx.session.deleteMany({ where: { userId: previousUserId } });
  await tx.user.delete({ where: { id: previousUserId } });
}

function toJsonValue(value?: Record<string, unknown>) {
  return value ? (value as Prisma.InputJsonValue) : undefined;
}

function sessionCookie(sessionId: string) {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secureCookieSuffix()}`;
}

function secureCookieSuffix() {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

function toAuthUser(user: {
  id: string;
  email: string | null;
  displayName: string;
  anonymous: boolean;
  role: UserRole;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    anonymous: user.anonymous,
    role: user.role,
  };
}
