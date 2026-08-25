import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

import { getDatabaseUrl, prisma } from "./prisma";
import { hashPassword, verifyPassword } from "./crypto";

export const SESSION_COOKIE = "cyanyi_session";
const SESSION_DAYS = 30;

export type AuthUser = {
  id: string;
  email: string | null;
  displayName: string;
  anonymous: boolean;
};

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
    user: { id: userId, email: null, displayName: "本地用户", anonymous: true },
    sessionId,
  };
}

async function ensureDatabaseConfigured() {
  if (!getDatabaseUrl())
    throw new Error(
      "DATABASE_URL must be configured with a MySQL connection string.",
    );
}

export function attachSessionCookie(
  response: Response,
  sessionId: string | null,
) {
  if (sessionId)
    response.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
    );
  return response;
}

export async function registerUser(
  email: string,
  password: string,
  displayName?: string,
) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error("INVALID_EMAIL");
  if (password.length < 8) throw new Error("PASSWORD_TOO_SHORT");
  if (await prisma.user.findUnique({ where: { email: normalizedEmail } }))
    throw new Error("EMAIL_ALREADY_REGISTERED");

  const previousUser = await getCurrentUser();
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: normalizedEmail,
      passwordHash: hashPassword(password),
      displayName: displayName?.trim() || normalizedEmail.split("@")[0],
      anonymous: false,
    },
  });
  if (previousUser?.anonymous) {
    await prisma.$transaction([
      prisma.channel.updateMany({
        where: { userId: previousUser.id },
        data: { userId: user.id },
      }),
      prisma.project.updateMany({
        where: { userId: previousUser.id },
        data: { userId: user.id },
      }),
      prisma.mediaTask.updateMany({
        where: { userId: previousUser.id },
        data: { userId: user.id },
      }),
      prisma.session.deleteMany({ where: { userId: previousUser.id } }),
      prisma.user.delete({ where: { id: previousUser.id } }),
    ]);
  }
  return { user: toAuthUser(user), sessionId: await createSession(user.id) };
}

export async function loginUser(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (!user?.passwordHash || !verifyPassword(password, user.passwordHash))
    throw new Error("INVALID_CREDENTIALS");
  return { user: toAuthUser(user), sessionId: await createSession(user.id) };
}

export async function destroyCurrentSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (sessionId) await prisma.session.deleteMany({ where: { id: sessionId } });
}

async function createSession(userId: string) {
  const id = randomUUID();
  await prisma.session.create({
    data: {
      id,
      userId,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
    },
  });
  return id;
}

function toAuthUser(user: {
  id: string;
  email: string | null;
  displayName: string;
  anonymous: boolean;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    anonymous: user.anonymous,
  };
}
