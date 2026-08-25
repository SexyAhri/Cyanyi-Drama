import { loginUser, SESSION_COOKIE } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const { user, sessionId } = await loginUser(body.email ?? "", body.password ?? "");
    const response = Response.json({ user });
    response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    return response;
  } catch {
    return Response.json({ message: "邮箱或密码错误" }, { status: 401 });
  }
}
