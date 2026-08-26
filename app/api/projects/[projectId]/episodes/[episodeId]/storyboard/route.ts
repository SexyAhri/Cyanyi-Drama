import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { getStoryboard, saveStoryboard } from "@/lib/novel/domain-store";
import { listLatestStoryboardContinuityIssues } from "@/lib/novel/continuity-store";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { createOrReuseWorkflowRun } from "@/lib/workflow/store";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const [storyboard, continuityIssues] = await Promise.all([
    getStoryboard(user.id, projectId, episodeId),
    listLatestStoryboardContinuityIssues(user.id, projectId, episodeId),
  ]);
  return attachSessionCookie(
    Response.json({ storyboard, continuityIssues }),
    sessionId,
  );
}

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await readObject(request);
  const channelId =
    typeof body.channelId === "string" ? body.channelId.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const locale = body.locale === "en" ? "en" : "zh";
  const concurrency =
    typeof body.concurrency === "number" && Number.isFinite(body.concurrency)
      ? Math.max(1, Math.min(8, Math.floor(body.concurrency)))
      : 3;
  if (!channelId || !model)
    return attachSessionCookie(
      Response.json(
        { message: "channelId 和 model 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  const result = await createOrReuseWorkflowRun({
    id: `workflow_${crypto.randomUUID()}`,
    userId: user.id,
    projectId,
    episodeId,
    workflowType: "script-to-storyboard",
    targetType: "episode",
    targetId: episodeId,
    input: { channelId, model, locale, concurrency },
    steps: [
      {
        key: "storyboard",
        type: "build_storyboard",
        artifactTypes: [
          "storyboard.clip.phase1",
          "storyboard.clip.phase2.cine",
          "storyboard.clip.phase2.acting",
          "storyboard.clip.phase3",
          "storyboard.clip.continuity",
          "prompt.trace",
        ],
        input: { channelId, model, locale, concurrency },
        retryable: true,
        maxAttempts: 3,
      },
      {
        key: "voice",
        type: "voice_analyze",
        dependsOn: ["storyboard"],
        artifactTypes: ["voice.lines", "prompt.trace"],
        input: { channelId, model, locale },
        retryable: true,
        maxAttempts: 3,
      },
    ],
    maxAttempts: 3,
  });
  if (!result)
    return attachSessionCookie(
      Response.json({ message: "项目或剧集不存在" }, { status: 404 }),
      sessionId,
    );
  if (!result.reused)
    await enqueueWorkflowJob({
      runId: result.workflow.id,
      userId: user.id,
      projectId,
      maxAttempts: 1,
    });
  return attachSessionCookie(
    Response.json(
      { workflow: result.workflow, reused: result.reused },
      { status: result.reused ? 200 : 202 },
    ),
    sessionId,
  );
}

export async function PUT(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await readObject(request);
  const panels = Array.isArray(body.panels)
    ? body.panels.filter(isPanelInput)
    : [];
  const storyboard = await saveStoryboard(user.id, projectId, episodeId, {
    status: typeof body.status === "string" ? body.status : undefined,
    sourceHash: typeof body.sourceHash === "string" ? body.sourceHash : null,
    panels,
  });
  if (!storyboard)
    return attachSessionCookie(
      Response.json({ message: "剧集不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(Response.json({ storyboard }), sessionId);
}

function isPanelInput(value: unknown): value is {
  panelIndex: number;
  clipId?: string | null;
  clipPanelIndex?: number | null;
  shotType?: string | null;
  cameraMove?: string | null;
  description?: string | null;
  locationName?: string | null;
  characters?: string[];
  props?: string[];
  imagePrompt?: string | null;
  videoPrompt?: string | null;
  phase?: string;
  status?: string;
  srtStart?: number | null;
  srtEnd?: number | null;
  durationSeconds?: number | null;
  subtitleText?: string | null;
  actingNotes?: Record<string, unknown>;
  photographyRules?: string | null;
  firstLastFramePrompt?: string | null;
  linkedToNextPanel?: boolean;
  sourceEvidence?: string[];
} {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.panelIndex === "number" &&
    Number.isInteger(item.panelIndex) &&
    ((item.clipId == null && item.clipPanelIndex == null) ||
      (typeof item.clipId === "string" &&
        typeof item.clipPanelIndex === "number" &&
        Number.isInteger(item.clipPanelIndex) &&
        item.clipPanelIndex >= 0)) &&
    (item.sourceEvidence === undefined ||
      (Array.isArray(item.sourceEvidence) &&
        item.sourceEvidence.every((entry) => typeof entry === "string")))
  );
}

async function readObject(request: Request) {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
