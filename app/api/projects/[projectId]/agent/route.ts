import { studioProductionOptionsSchema } from "@/lib/studio/production-input";
import { createAgentEventStreamResponse } from "@/lib/agent/stream";
import {
  resolveStudioAgentApproval,
  runStudioAgent,
  StudioAgentError,
  type StudioAgentContext,
} from "@/lib/studio/agent-runtime";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

type Context = { params: Promise<{ projectId: string }> };

export const maxDuration = 300;

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  try {
    const events =
      typeof body.approvalId === "string" &&
      (body.decision === "approved" || body.decision === "denied")
        ? resolveStudioAgentApproval({
            approvalId: body.approvalId,
            decision: body.decision,
            projectId,
            userId: user.id,
          })
        : await runStudioAgent({
            content: typeof body.content === "string" ? body.content : "",
            context: readStudioContext(body),
            modelSelection: readStudioAgentModel(metadata),
            productionOptions: studioProductionOptionsSchema.safeParse(metadata.productionOptions).data,
            conversation: readConversation(metadata.conversation),
            locale:
              body.locale === "en" || metadata.locale === "en" ? "en" : "zh-CN",
            projectId,
            userId: user.id,
          });
    return attachSessionCookie(
      createAgentEventStreamResponse(events),
      sessionId,
    );
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        { message: error instanceof Error ? error.message : "Agent 请求失败" },
        { status: error instanceof StudioAgentError ? error.status : 500 },
      ),
      sessionId,
    );
  }
}

function readStudioContext(body: Record<string, unknown>) {
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  const context = isRecord(metadata.studioContext)
    ? metadata.studioContext
    : {};
  return context as StudioAgentContext;
}

function readStudioAgentModel(metadata: Record<string, unknown>) {
  const value = isRecord(metadata.studioAgentModel)
    ? metadata.studioAgentModel
    : null;
  return value &&
    typeof value.channelId === "string" &&
    typeof value.model === "string"
    ? { channelId: value.channelId, model: value.model }
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function readObject(request: Request) {
  try {
    const value: unknown = await request.json();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function readConversation(value: unknown): Array<{role: "user" | "assistant"; content: string}> {
  if (!Array.isArray(value)) return [];
  return value.slice(-12).flatMap(item => isRecord(item) && (item.role === "user" || item.role === "assistant") && typeof item.content === "string" ? [{ role: item.role as "user" | "assistant", content: item.content.slice(0, 4000) }] : []);
}
