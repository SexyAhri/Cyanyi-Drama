import { clearSessionCookie, destroyCurrentSession } from "@/lib/server/auth";

export async function POST() {
  await destroyCurrentSession();
  return clearSessionCookie(Response.json({ ok: true }));
}
