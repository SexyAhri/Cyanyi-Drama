import { sendRegistrationVerificationCode } from "@/lib/server/email-verification";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string };
    const result = await sendRegistrationVerificationCode(body.email ?? "");
    return Response.json(result);
  } catch (error) {
    const message = readableEmailError(error);
    const status =
      error instanceof Error && error.message === "EMAIL_ALREADY_REGISTERED"
        ? 409
        : error instanceof Error && error.message.startsWith("EMAIL_RATE_LIMIT")
          ? 429
          : 400;
    return Response.json({ message }, { status });
  }
}

function readableEmailError(error: unknown) {
  if (!(error instanceof Error)) return "验证码发送失败，请稍后重试";
  if (error.message.startsWith("EMAIL_RATE_LIMIT:")) {
    return `发送过于频繁，请在 ${error.message.split(":")[1]} 秒后重试`;
  }
  return (
    {
      INVALID_EMAIL: "邮箱格式不正确",
      EMAIL_ALREADY_REGISTERED: "该邮箱已经注册，请直接登录",
      EMAIL_HOURLY_LIMIT: "发送次数过多，请一小时后再试",
      EMAIL_VERIFICATION_DISABLED: "当前未启用邮箱验证码",
      EMAIL_SERVICE_NOT_CONFIGURED: "邮箱服务尚未配置",
    } as Record<string, string>
  )[error.message] ?? "验证码发送失败，请检查邮箱服务配置";
}
