import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  regenerateWithPublishedConfiguration,
  regenerationRequestSchema,
} from "@/lib/production-configuration/regeneration";
import { productionRequestErrorStatus } from "@/lib/production-configuration/execution";
import { BillingError } from "@/lib/billing/service";
import { ProjectAssetTaskError } from "@/lib/media/project-asset-tasks";
import { VoiceTaskError } from "@/lib/media/voice-tasks";

export async function POST(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  try {
    const input = regenerationRequestSchema.parse(await request.json());
    return attachSessionCookie(
      Response.json(
        await regenerateWithPublishedConfiguration(user.id, input),
        { status: input.preview ? 200 : 202 },
      ),
      sessionId,
    );
  } catch (error) {
    const status =
      productionRequestErrorStatus(error) ??
      (error instanceof BillingError ||
      error instanceof ProjectAssetTaskError ||
      error instanceof VoiceTaskError
        ? error.status
        : 500);
    return attachSessionCookie(
      Response.json(
        { message: error instanceof Error ? error.message : "重新生成失败" },
        { status },
      ),
      sessionId,
    );
  }
}
