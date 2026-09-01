import {
  detectEpisodeMarkers,
  EpisodeSplitError,
  MAX_MANUSCRIPT_CHARS,
  persistEpisodeSplits,
  saveManuscript,
  updateManuscriptMetadata,
  type EpisodeSplitDraft,
} from "@/lib/episodes/split";
import { extractManuscriptMetadata } from "@/lib/episodes/manuscript-metadata";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import {
  createOrReuseWorkflowRun,
  getWorkflowRun,
} from "@/lib/workflow/store";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  try {
    if (body.persist === true && stringValue(body.manuscriptId)) {
      const manuscriptId = stringValue(body.manuscriptId)!;
      const episodes = episodeDrafts(body.episodes);
      if (!episodes.length) throw new EpisodeSplitError("没有可确认的分集预览");
      const manuscript = await updateManuscriptMetadata({
        userId: user.id,
        projectId,
        manuscriptId,
        title: stringValue(body.title) ?? "",
        author: stringValue(body.author),
        synopsis: stringValue(body.synopsis),
      });
      const persisted = await persistEpisodeSplits({
        userId: user.id,
        projectId,
        manuscriptId,
        episodes,
      });
      return attachSessionCookie(
        Response.json({
          method: splitMethod(body.method),
          markerType: stringValue(body.markerType) ?? null,
          confidence: confidence(body.confidence),
          manuscript,
          episodes: withoutEpisodeContent(episodes),
          persisted,
          trace: null,
        }),
        sessionId,
      );
    }

    const content = stringValue(body.content) ?? "";
    if (content.length < 100 || content.length > MAX_MANUSCRIPT_CHARS)
      throw new EpisodeSplitError(
        `整本小说长度必须在 100 到 ${MAX_MANUSCRIPT_CHARS.toLocaleString()} 字符之间`,
      );
    const sourceFileName = stringValue(body.sourceFileName);
    const extracted = extractManuscriptMetadata(content, sourceFileName);
    const manuscript = await saveManuscript({
      userId: user.id,
      projectId,
      content,
      title: stringValue(body.title) ?? extracted.title,
      author: stringValue(body.author) ?? extracted.author,
      synopsis: stringValue(body.synopsis) ?? extracted.synopsis,
      sourceFileName,
    });
    const mode =
      body.mode === "markers" || body.mode === "ai" ? body.mode : "auto";
    const markers = detectEpisodeMarkers(content);
    let method: "markers" | "ai";
    let episodes: EpisodeSplitDraft[];
    let trace;
    let workflowId: string | undefined;
    if (mode !== "ai" && markers.hasMarkers) {
      method = "markers";
      episodes = markers.episodes;
    } else {
      if (mode === "markers")
        throw new EpisodeSplitError("没有检测到至少两个可靠分集标记");
      const channelId = stringValue(body.channelId);
      const model = stringValue(body.model);
      if (!channelId || !model)
        throw new EpisodeSplitError("未检测到章节标记，请选择 AI 分集模型后重试");
      method = "ai";
      const result = await runAiSplitWorkflow({
        userId: user.id,
        projectId,
        manuscriptId: manuscript.id,
        channelId,
        model,
        locale: body.locale === "en" ? "en" : "zh",
      });
      episodes = result.episodes;
      trace = result.trace;
      workflowId = result.workflowId;
    }
    const persisted =
      body.persist === true
        ? await persistEpisodeSplits({
            userId: user.id,
            projectId,
            manuscriptId: manuscript.id,
            episodes,
          })
        : null;
    return attachSessionCookie(
      Response.json({
        method,
        markerType: method === "markers" ? markers.markerType : null,
        confidence: method === "markers" ? markers.confidence : null,
        manuscript,
        episodes: withoutEpisodeContent(episodes),
        persisted,
        trace: trace ?? null,
        workflowId,
      }),
      sessionId,
    );
  } catch (error) {
    if (error instanceof EpisodeSplitError)
      return attachSessionCookie(
        Response.json({ message: error.message }, { status: error.status }),
        sessionId,
      );
    throw error;
  }
}

async function runAiSplitWorkflow(input: {
  userId: string;
  projectId: string;
  manuscriptId: string;
  channelId: string;
  model: string;
  locale: "en" | "zh";
}) {
  const workflowInput = {
    manuscriptId: input.manuscriptId,
    channelId: input.channelId,
    model: input.model,
    locale: input.locale,
  };
  const runtimeSettings = await loadUserRuntimeSettings(input.userId);
  const result = await createOrReuseWorkflowRun({
    id: `workflow_${crypto.randomUUID()}`,
    userId: input.userId,
    projectId: input.projectId,
    workflowType: "episode-split-planning",
    targetType: "manuscript",
    targetId: input.manuscriptId,
    input: workflowInput,
    steps: [
      {
        key: "plan_episode_split",
        type: "plan_episode_split",
        artifactTypes: [
          "episode.split-plan",
          "episode.split-plan.raw",
          "prompt.trace",
        ],
        input: workflowInput,
        retryable: true,
        maxAttempts: runtimeSettings.workflowStepMaxAttempts,
      },
    ],
    maxAttempts: runtimeSettings.workflowStepMaxAttempts,
  });
  if (!result) throw new EpisodeSplitError("项目不存在", 404);
  try {
    if (!result.reused)
      await enqueueWorkflowJob({
        runId: result.workflow.id,
        userId: input.userId,
        projectId: input.projectId,
        maxAttempts: 1,
      });
    while (true) {
      const workflow = await getWorkflowRun(input.userId, result.workflow.id);
      if (!workflow) throw new Error("WORKFLOW_RUN_NOT_FOUND");
      if (workflow.status === "succeeded") {
        if (!isEpisodeSplitOutput(workflow.output))
          throw new Error("WORKFLOW_EPISODE_SPLIT_OUTPUT_MISSING");
        return { ...workflow.output, workflowId: result.workflow.id };
      }
      if (["failed", "blocked", "canceled"].includes(workflow.status))
        throw new Error(workflowErrorMessage(workflow.error));
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  } catch (error) {
    throw new EpisodeSplitError(
      error instanceof Error ? error.message : "AI 分集失败",
      502,
    );
  }
}

function isEpisodeSplitOutput(value: unknown): value is {
  episodes: EpisodeSplitDraft[];
  trace: Record<string, unknown>;
} {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { episodes?: unknown }).episodes)
  );
}

function workflowErrorMessage(error: Record<string, unknown> | undefined) {
  return typeof error?.message === "string" && error.message.trim()
    ? error.message
    : "WORKFLOW_EPISODE_SPLIT_FAILED";
}

function episodeDrafts(value: unknown): EpisodeSplitDraft[] {
  if (!Array.isArray(value) || value.length > 10_000) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const number = numberValue(row.number);
    const startIndex = numberValue(row.startIndex);
    const endIndex = numberValue(row.endIndex);
    const title = stringValue(row.title)?.trim();
    if (
      !Number.isInteger(number) ||
      number <= 0 ||
      !Number.isInteger(startIndex) ||
      startIndex < 0 ||
      !Number.isInteger(endIndex) ||
      endIndex <= startIndex ||
      !title ||
      title.length > 160
    )
      return [];
    return [
      {
        number,
        title,
        summary: stringValue(row.summary)?.trim().slice(0, 4_000) ?? "",
        content: "",
        wordCount: Math.max(0, numberValue(row.wordCount)),
        startIndex,
        endIndex,
      },
    ];
  });
}

function withoutEpisodeContent(episodes: EpisodeSplitDraft[]) {
  return episodes.map((episode) => ({ ...episode, content: "" }));
}

function splitMethod(value: unknown): "markers" | "ai" {
  return value === "ai" ? "ai" : "markers";
}

function confidence(value: unknown): "high" | "medium" | "low" | null {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : null;
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

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
