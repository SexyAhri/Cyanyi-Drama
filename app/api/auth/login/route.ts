import { attachSessionCookie, loginUser } from "@/lib/server/auth";
import {
  clearLoginFailures,
  consumeLoginAttempt,
  LoginRateLimitUnavailableError,
  recordFailedLogin,
} from "@/lib/server/login-rate-limit";

export async function POST(request: Request) {
  let attemptedEmail = "";
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    attemptedEmail = body.email ?? "";
    const rateLimit = await consumeLoginAttempt(
      attemptedEmail,
      request.headers,
    );
    if (!rateLimit.allowed) {
      return Response.json(
        { message: "登录尝试过多，请稍后重试" },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }
    const { user, sessionId } = await loginUser(
      attemptedEmail,
      body.password ?? "",
    );
    try {
      await clearLoginFailures(attemptedEmail);
    } catch {
      // A successful login should still complete if the limiter goes down.
    }
    return attachSessionCookie(Response.json({ user }), sessionId);
  } catch (error) {
    if (error instanceof LoginRateLimitUnavailableError) {
      return Response.json(
        { message: "登录暂不可用，请稍后重试" },
        { status: 503 },
      );
    }
    if (error instanceof Error && error.message === "INVALID_CREDENTIALS") {
      try {
        await recordFailedLogin(attemptedEmail);
      } catch {
        return Response.json(
          { message: "登录暂不可用，请稍后重试" },
          { status: 503 },
        );
      }
    }
    return Response.json({ message: "邮箱或密码错误" }, { status: 401 });
  }
}
