import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { getStoryboard, saveStoryboard } from "@/lib/novel/domain-store";
import type { StoryboardPromptDesignDetails } from "@/lib/novel/domain-types";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { createOrReuseWorkflowRun } from "@/lib/workflow/store";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const storyboard = await getStoryboard(user.id, projectId, episodeId);
  return attachSessionCookie(
    Response.json({
      storyboard,
      continuityIssues: [],
    }),
    sessionId,
  );
}

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await readObject(request);
  const locale = body.locale === "en" ? "en" : "zh";
  const result = await createOrReuseWorkflowRun({
    id: `workflow_${crypto.randomUUID()}`,
    userId: user.id,
    projectId,
    episodeId,
    workflowType: "script-to-storyboard",
    targetType: "episode",
    targetId: episodeId,
    input: { locale },
    steps: [
      {
        key: "build_scene_storyboard",
        type: "build_scene_storyboard",
        artifactTypes: ["storyboard.scenes"],
        input: { locale },
        retryable: false,
        maxAttempts: 1,
      },
    ],
    maxAttempts: 1,
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
  id?: string;
  panelIndex: number;
  sceneNumber?: number | null;
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
  imagePromptDesign?: StoryboardPromptDesignDetails | null;
  videoPromptDesign?: StoryboardPromptDesignDetails | null;
  firstLastFramePromptDesign?: StoryboardPromptDesignDetails | null;
  phase?: string;
  status?: string;
  srtStart?: number | null;
  srtEnd?: number | null;
  durationSeconds?: number | null;
  subtitleText?: string | null;
  speakingCharacter?: string | null;
  lipSyncText?: string | null;
  voiceoverText?: string | null;
  startState?: Record<string, unknown>;
  endState?: Record<string, unknown>;
  motionBeats?: Array<Record<string, unknown>>;
  worldContext?: Record<string, unknown>;
  vfxCues?: Array<Record<string, unknown>>;
  sfxCues?: Array<Record<string, unknown>>;
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
        item.sourceEvidence.every((entry) => typeof entry === "string"))) &&
    [
      item.imagePromptDesign,
      item.videoPromptDesign,
      item.firstLastFramePromptDesign,
    ].every(
      (details) =>
        details === undefined ||
        details === null ||
        isPromptDesignDetails(details),
    )
  );
}

function isPromptDesignDetails(
  value: unknown,
): value is StoryboardPromptDesignDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const details = value as Record<string, unknown>;
  return [details.designNotes, details.continuitySafeguards].every(
    (items) =>
      Array.isArray(items) &&
      items.length <= 16 &&
      items.every(
        (item) =>
          typeof item === "string" &&
          item.trim().length > 0 &&
          item.length <= 600,
      ),
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
