import { attachSessionCookie, registerUser } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      displayName?: string;
      verificationCode?: string;
    };
    const { user, sessionId } = await registerUser(
      body.email ?? "",
      body.password ?? "",
      body.displayName,
      body.verificationCode,
    );
    return attachSessionCookie(
      Response.json({ user }, { status: 201 }),
      sessionId,
    );
  } catch (error) {
    return Response.json({ message: readableAuthError(error) }, { status: 400 });
  }
}

function readableAuthError(error: unknown) {
  if (!(error instanceof Error)) return "Registration failed.";
  return ({
    INVALID_EMAIL: "邮箱格式不正确",
    PASSWORD_TOO_SHORT: "密码至少需要 8 位",
    EMAIL_ALREADY_REGISTERED: "邮箱已注册",
    INVALID_VERIFICATION_CODE: "验证码错误、已过期或已使用",
  } as Record<string, string>)[error.message] ?? "注册失败，请稍后重试";
}
