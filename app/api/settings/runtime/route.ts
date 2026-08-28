import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { runtimeSettingsSchema } from "@/lib/settings/runtime-contract";
import {
  loadUserRuntimeSettings,
  saveUserRuntimeSettings,
} from "@/lib/settings/runtime-store";

export async function GET() {
  const { user, sessionId } = await ensureAnonymousUser();
  const settings = await loadUserRuntimeSettings(user.id);
  return attachSessionCookie(Response.json({ settings }), sessionId);
}

export async function PUT(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const parsed = runtimeSettingsSchema.safeParse(await readJson(request));
  if (!parsed.success)
    return attachSessionCookie(
      Response.json(
        { message: "运行设置格式不正确", issues: parsed.error.issues },
        { status: 400 },
      ),
      sessionId,
    );
  const settings = await saveUserRuntimeSettings(user.id, parsed.data);
  return attachSessionCookie(Response.json({ settings }), sessionId);
}

async function readJson(request: Request) {
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
}
