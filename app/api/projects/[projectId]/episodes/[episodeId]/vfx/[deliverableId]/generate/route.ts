import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { ProductionTaskError } from "@/lib/media/production-tasks";
import {
  createVfxShotTask,
} from "@/lib/production/vfx-tasks";
import { VFX_TASK_STAGES, type VfxTaskStage } from "@/lib/production/vfx-contract";

type Context = {
  params: Promise<{
    projectId: string;
    episodeId: string;
    deliverableId: string;
  }>;
};

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId, deliverableId } = await context.params;
  const body = await readObject(request);
  const stage = stringValue(body.stage);
  const kind = body.kind === "image" ? "image" : "video";
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  const prompt = stringValue(body.prompt);
  if (!isStage(stage) || !channelId || !model || !prompt)
    return attachSessionCookie(
      Response.json({ message: "VFX_TASK_INPUT_REQUIRED" }, { status: 400 }),
      sessionId,
    );
  try {
    const task = await createVfxShotTask({
      userId: user.id,
      projectId,
      episodeId,
      deliverableId,
      stage,
      kind,
      channelId,
      model,
      prompt,
      ratio: stringValue(body.ratio) || undefined,
      resolution: stringValue(body.resolution) || undefined,
      duration: stringValue(body.duration) || undefined,
    });
    return attachSessionCookie(Response.json({ task }, { status: 202 }), sessionId);
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        {
          message:
            error instanceof Error ? error.message : "VFX_TASK_CREATE_FAILED",
        },
        { status: error instanceof ProductionTaskError ? error.status : 500 },
      ),
      sessionId,
    );
  }
}

function isStage(value: string): value is VfxTaskStage {
  return VFX_TASK_STAGES.some((stage) => stage === value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function readObject(request: Request) {
  const value: unknown = await request.json().catch(() => ({}));
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
