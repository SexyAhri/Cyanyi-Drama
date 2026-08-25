import { registerUser, SESSION_COOKIE } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string; displayName?: string };
    const { user, sessionId } = await registerUser(body.email ?? "", body.password ?? "", body.displayName);
    const response = Response.json({ user }, { status: 201 });
    response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    return response;
  } catch (error) {
    return Response.json({ message: readableAuthError(error) }, { status: 400 });
  }
}

function readableAuthError(error: unknown) {
  if (!(error instanceof Error)) return "Registration failed.";
  return ({ INVALID_EMAIL: "邮箱格式不正确", PASSWORD_TOO_SHORT: "密码至少需要 8 位", EMAIL_ALREADY_REGISTERED: "邮箱已注册" } as Record<string, string>)[error.message] ?? "Registration failed.";
}
