import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { getAppSecret } from "./app-secret";
import { getPublicAuthConfig } from "./auth-config";
import { sendRegistrationVerificationEmail } from "./email";
import { prisma } from "./prisma";

const PURPOSE = "register";
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_INTERVAL_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

type VerificationRecord = {
  attemptCount: number;
  codeHash: string;
  consumedAt: Date | null;
  expiresAt: Date;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function hashEmailVerificationCode(email: string, code: string) {
  return createHmac("sha256", getAppSecret())
    .update(`${PURPOSE}:${normalizeEmail(email)}:${code}`)
    .digest("hex");
}

export function codesMatch(expectedHash: string, actualHash: string) {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function emailVerificationWaitSeconds(
  latestCreatedAt: Date | null,
  now = new Date(),
) {
  if (!latestCreatedAt) return 0;
  const remaining =
    RESEND_INTERVAL_MS - (now.getTime() - latestCreatedAt.getTime());
  return Math.max(0, Math.ceil(remaining / 1000));
}

export function registrationVerificationStatus(
  verification: VerificationRecord | null,
  email: string,
  code: string,
  now = new Date(),
) {
  if (
    !verification ||
    verification.consumedAt ||
    verification.expiresAt <= now ||
    verification.attemptCount >= MAX_ATTEMPTS
  ) {
    return "unavailable" as const;
  }
  return codesMatch(
    verification.codeHash,
    hashEmailVerificationCode(email, code),
  )
    ? ("valid" as const)
    : ("invalid" as const);
}

export async function sendRegistrationVerificationCode(email: string) {
  if (!(await getPublicAuthConfig()).emailVerificationEnabled) {
    throw new Error("EMAIL_VERIFICATION_DISABLED");
  }

  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) throw new Error("INVALID_EMAIL");
  if (await prisma.user.findUnique({ where: { email: normalizedEmail } })) {
    throw new Error("EMAIL_ALREADY_REGISTERED");
  }

  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const recent = await prisma.emailVerification.findMany({
    where: {
      email: normalizedEmail,
      purpose: PURPOSE,
      createdAt: { gte: hourAgo },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const waitSeconds = emailVerificationWaitSeconds(
    recent[0]?.createdAt ?? null,
    now,
  );
  if (waitSeconds > 0) throw new Error(`EMAIL_RATE_LIMIT:${waitSeconds}`);
  if (recent.length >= MAX_SENDS_PER_HOUR) {
    throw new Error("EMAIL_HOURLY_LIMIT");
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const verification = await prisma.emailVerification.create({
    data: {
      email: normalizedEmail,
      purpose: PURPOSE,
      codeHash: hashEmailVerificationCode(normalizedEmail, code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    },
  });

  try {
    await sendRegistrationVerificationEmail(normalizedEmail, code);
  } catch (error) {
    await prisma.emailVerification.deleteMany({
      where: { id: verification.id },
    });
    throw error;
  }

  return { expiresInSeconds: CODE_TTL_MS / 1000 };
}

export async function verifyRegistrationCode(email: string, code: string) {
  if (!(await getPublicAuthConfig()).emailVerificationEnabled) return null;
  if (!/^\d{6}$/.test(code)) throw new Error("INVALID_VERIFICATION_CODE");

  const normalizedEmail = normalizeEmail(email);
  const now = new Date();
  const verification = await prisma.emailVerification.findFirst({
    where: {
      email: normalizedEmail,
      purpose: PURPOSE,
      consumedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });
  const status = registrationVerificationStatus(
    verification,
    normalizedEmail,
    code,
    now,
  );

  if (status !== "valid") {
    if (verification && status === "invalid") {
      const nextAttempt = verification.attemptCount + 1;
      await prisma.emailVerification.updateMany({
        where: { id: verification.id, consumedAt: null },
        data: {
          attemptCount: { increment: 1 },
          ...(nextAttempt >= MAX_ATTEMPTS ? { consumedAt: now } : {}),
        },
      });
    }
    throw new Error("INVALID_VERIFICATION_CODE");
  }

  if (!verification) throw new Error("INVALID_VERIFICATION_CODE");
  return verification.id;
}

export async function consumeRegistrationCode(
  tx: Prisma.TransactionClient,
  verificationId: string | null,
) {
  if (!verificationId) return;
  const result = await tx.emailVerification.updateMany({
    where: {
      id: verificationId,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { consumedAt: new Date() },
  });
  if (result.count !== 1) throw new Error("INVALID_VERIFICATION_CODE");
}
