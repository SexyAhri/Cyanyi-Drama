import { z } from "zod";

import { attachSessionCookie } from "@/lib/server/auth";
import { initializeAdmin } from "@/lib/server/initial-admin";

export async function POST(request: Request) {
  // This endpoint has no authenticated user yet; only same-origin JSON forms
  // may claim the first account. APP_BASE_URL supports reverse-proxy deployments.
  const origin = request.headers.get("origin");
  const allowedOrigins = [new URL(request.url).origin];
  if (process.env.APP_BASE_URL) {
    try { allowedOrigins.push(new URL(process.env.APP_BASE_URL).origin); } catch { /* Invalid configuration is not trusted. */ }
  }
  if (!origin || !allowedOrigins.includes(origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ message: "请从本站页面提交初始化设置" }, { status: 403 });
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
    return Response.json({ message: "请求格式不正确" }, { status: 415 });
  }

  try {
    if (Number(request.headers.get("content-length")) > 8192) {
      return Response.json({ message: "提交内容过长" }, { status: 413 });
    }
    const text = await request.text();
    if (text.length > 8192) {
      return Response.json({ message: "提交内容过长" }, { status: 413 });
    }
    const { user, sessionId } = await initializeAdmin(JSON.parse(text));
    return attachSessionCookie(Response.json({ user }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    }), sessionId);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ message: error.issues[0]?.message ?? "请检查填写内容" }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return Response.json({ message: "请求格式不正确" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "INITIAL_SETUP_COMPLETED") {
      return Response.json({ code: "INITIAL_SETUP_COMPLETED", message: "本站已完成初始化，请使用已有账号登录" }, { status: 409 });
    }
    console.error("Initial administrator setup failed", error);
    return Response.json({ message: "初始化暂未完成，请稍后重试" }, { status: 503 });
  }
}
