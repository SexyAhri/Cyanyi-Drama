import { destroyCurrentSession, SESSION_COOKIE } from "@/lib/server/auth";

export async function POST() {
  await destroyCurrentSession();
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}
