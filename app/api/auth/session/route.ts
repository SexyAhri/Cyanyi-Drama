import { ensureAnonymousUser, SESSION_COOKIE } from "@/lib/server/auth";

export async function GET() {
  const { user, sessionId } = await ensureAnonymousUser();
  const response = Response.json({ user });
  if (sessionId) {
    response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  }
  return response;
}
