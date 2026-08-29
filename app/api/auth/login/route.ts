import { attachSessionCookie, loginUser } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const { user, sessionId } = await loginUser(body.email ?? "", body.password ?? "");
    return attachSessionCookie(Response.json({ user }), sessionId);
  } catch {
    return Response.json({ message: "邮箱或密码错误" }, { status: 401 });
  }
}
