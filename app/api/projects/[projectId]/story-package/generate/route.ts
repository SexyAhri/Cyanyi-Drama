import { storySetupSchema } from "@/lib/studio/production-input";
import { z } from "zod";

import { EpisodeSplitError } from "@/lib/episodes/errors";
import { StoryPackageGenerationError } from "@/lib/production/story-package-generation";
import { startStudioProductionAction } from "@/lib/studio/agent-production-actions";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export const maxDuration = 300;

type Context = { params: Promise<{ projectId: string }> };

const requestSchema = z.object({
  channelId: z.string().trim().min(1),
  model: z.string().trim().min(1),
  locale: z.enum(["zh", "en"]).default("zh"),
  setup: storySetupSchema,
});

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return attachSessionCookie(
      Response.json(
        { message: "STORY_PACKAGE_INPUT_INVALID" },
        { status: 400 },
      ),
      sessionId,
    );
  try {
    const result = await startStudioProductionAction({
      userId: user.id,
      projectId,
      operation: "start_story_package_generation", targetId: projectId,
      channelId: parsed.data.channelId, model: parsed.data.model, locale: parsed.data.locale,
      options: { storySetup: parsed.data.setup },
    });
    return attachSessionCookie(
      Response.json(result, { status: 202 }),
      sessionId,
    );
  } catch (error) {
    const known =
      error instanceof StoryPackageGenerationError ||
      error instanceof EpisodeSplitError;
    const status = known
      ? (error as StoryPackageGenerationError | EpisodeSplitError).status
      : 500;
    const message = known
      ? error instanceof Error
        ? error.message
        : "STORY_PACKAGE_GENERATION_FAILED"
      : error instanceof Error
        ? error.message
        : "STORY_PACKAGE_GENERATION_FAILED";
    return attachSessionCookie(
      Response.json({ message }, { status }),
      sessionId,
    );
  }
}
