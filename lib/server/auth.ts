import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

import { getDatabase, persistDatabase, queryRows, runSql } from "./database";
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
  const cookieStore = await cookies();
  return getUserBySession(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function ensureAnonymousUser() {
  const existing = await getCurrentUser();
  if (existing) return { user: existing, sessionId: null };

  const user = await createUser({ displayName: "本地用户", anonymous: true });
  const sessionId = await createSession(user.id);
  return { user, sessionId };
}

export function attachSessionCookie(
  response: Response,
  sessionId: string | null,
) {
  if (sessionId) {
    response.headers.append(
      "Set-Cookie",
      `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
    );
  }
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
  const database = await getDatabase();
  const existing = queryRows(
    database,
    "SELECT id FROM users WHERE email = ? LIMIT 1",
    [normalizedEmail],
  );
  if (existing.length) throw new Error("EMAIL_ALREADY_REGISTERED");
  const previousUser = await getCurrentUser();
  const user = await createUser({
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    displayName: displayName?.trim() || normalizedEmail.split("@")[0],
    anonymous: false,
  });
  if (previousUser?.anonymous) {
    runSql(database, "UPDATE channels SET user_id = ? WHERE user_id = ?", [user.id, previousUser.id]);
    runSql(database, "UPDATE media_tasks SET user_id = ? WHERE user_id = ?", [user.id, previousUser.id]);
    runSql(database, "DELETE FROM users WHERE id = ?", [previousUser.id]);
    await persistDatabase();
  }
  const sessionId = await createSession(user.id);
  return { user, sessionId };
}

export async function loginUser(email: string, password: string) {
  const database = await getDatabase();
  const rows = queryRows<{
    id: string;
    email: string;
    password_hash: string;
    display_name: string;
    anonymous: number;
  }>(
    database,
    "SELECT id, email, password_hash, display_name, anonymous FROM users WHERE email = ? LIMIT 1",
    [email.trim().toLowerCase()],
  );
  const row = rows[0];
  if (!row?.password_hash || !verifyPassword(password, row.password_hash))
    throw new Error("INVALID_CREDENTIALS");
  const user = toAuthUser(row);
  const sessionId = await createSession(user.id);
  return { user, sessionId };
}

export async function destroyCurrentSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return;
  const database = await getDatabase();
  runSql(database, "DELETE FROM sessions WHERE id = ?", [sessionId]);
  await persistDatabase();
}

async function getUserBySession(sessionId?: string) {
  if (!sessionId) return null;
  const database = await getDatabase();
  const rows = queryRows<{
    id: string;
    email: string | null;
    display_name: string;
    anonymous: number;
  }>(
    database,
    "SELECT u.id, u.email, u.display_name, u.anonymous FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ? LIMIT 1",
    [sessionId, new Date().toISOString()],
  );
  return rows[0] ? toAuthUser(rows[0]) : null;
}

async function createUser(input: {
  email?: string;
  passwordHash?: string;
  displayName: string;
  anonymous: boolean;
}): Promise<AuthUser> {
  const database = await getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();
  runSql(
    database,
    "INSERT INTO users (id, email, password_hash, display_name, anonymous, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      input.email ?? null,
      input.passwordHash ?? null,
      input.displayName,
      input.anonymous ? 1 : 0,
      now,
      now,
    ],
  );
  await persistDatabase();
  return {
    id,
    email: input.email ?? null,
    displayName: input.displayName,
    anonymous: input.anonymous,
  };
}

async function createSession(userId: string) {
  const database = await getDatabase();
  const id = randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  runSql(
    database,
    "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    [id, userId, expires.toISOString(), now.toISOString()],
  );
  await persistDatabase();
  return id;
}

function toAuthUser(row: {
  id: string;
  email: string | null;
  display_name: string;
  anonymous: number;
}): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    anonymous: Boolean(row.anonymous),
  };
}
