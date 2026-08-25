import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { createWorkflowRun } from "@/lib/workflow/store";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await readObject(request);
  const channelId =
    typeof body.channelId === "string" ? body.channelId.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!channelId || !model)
    return attachSessionCookie(
      Response.json(
        { message: "channelId 和 model 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  const workflow = await createWorkflowRun({
    id: `workflow_${crypto.randomUUID()}`,
    userId: user.id,
    projectId,
    episodeId,
    workflowType: "novel-production",
    input: { channelId, model },
    steps: [
      {
        key: "analyze_novel",
        type: "parse_novel",
        artifactTypes: [
          "analysis.characters",
          "analysis.locations",
          "analysis.props",
          "analysis.panels",
        ],
        input: { channelId, model },
      },
      {
        key: "split_clips",
        type: "split_clips",
        dependsOn: ["analyze_novel"],
        artifactTypes: ["clips.split"],
        input: {},
      },
      {
        key: "convert_screenplay",
        type: "convert_screenplay",
        dependsOn: ["split_clips"],
        artifactTypes: ["screenplay.clip"],
        input: {},
      },
      {
        key: "build_storyboard",
        type: "build_storyboard",
        dependsOn: ["convert_screenplay"],
        artifactTypes: ["storyboard.panels"],
        input: {},
      },
      {
        key: "voice_analyze",
        type: "voice_analyze",
        dependsOn: ["build_storyboard"],
        artifactTypes: ["voice.lines"],
        input: { channelId, model },
      },
    ],
    maxAttempts: 1,
  });
  if (!workflow)
    return attachSessionCookie(
      Response.json({ message: "项目或剧集不存在" }, { status: 404 }),
      sessionId,
    );
  await enqueueWorkflowJob({
    runId: workflow.id,
    userId: user.id,
    projectId,
    maxAttempts: 1,
  });
  return attachSessionCookie(
    Response.json({ workflow }, { status: 202 }),
    sessionId,
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
