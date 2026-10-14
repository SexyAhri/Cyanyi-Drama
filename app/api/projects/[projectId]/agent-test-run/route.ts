import { randomUUID } from "node:crypto";
import { previewStudioAgent, StudioAgentError } from "@/lib/studio/agent-runtime";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { studioAgentTestRunRequestSchema } from "@/lib/studio/agent-test-run-contract";
import { StructuredOutputError } from "@/lib/llm/structured-output";
import { summarizeAgentTestRunCost } from "@/lib/studio/agent-test-cost";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, route: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await route.params;
  try {
    const parsed = studioAgentTestRunRequestSchema.safeParse(await request.json());
    if (!parsed.success)
      return attachSessionCookie(Response.json({ message: "试运行输入无效", issues: parsed.error.issues }, { status: 400 }), sessionId);
    const result = await previewStudioAgent({
      ...parsed.data,
      projectId,
      userId: user.id,
    });
    return attachSessionCookie(Response.json(result), sessionId);
  } catch (error) {
    if (error instanceof StructuredOutputError && error.executionTrace) {
      const id = randomUUID();
      const trace = error.executionTrace;
      const costEstimate = summarizeAgentTestRunCost(trace.billing);
      return attachSessionCookie(
        Response.json(
          {
            message: error.code,
            testRunFailure: {
              id,
              trace: {
                promptId: trace.promptId,
                agentId: trace.agentId,
                promptVersion: trace.promptVersion,
                promptVersionHash: trace.promptVersionHash,
                model: trace.model,
                channelId: trace.channelId,
                structuredOutputMode: trace.structuredOutputMode,
                correctionAttempts: trace.correctionAttempts,
                tokenUsage: trace.tokenUsage,
                outputHash: trace.outputHash,
              },
              validation: {
                passed: false,
                schema: "studioWorkflowAgentSchema",
                code: error.code,
              },
              costEstimate,
              configurationSources: trace.configurationSources ?? [],
            },
          },
          { status: 502 },
        ),
        sessionId,
      );
    }
    const status = error instanceof StudioAgentError
      ? error.status
      : typeof error === "object" && error && "status" in error && typeof error.status === "number"
        ? error.status
        : 500;
    return attachSessionCookie(Response.json({ message: error instanceof Error ? error.message : "Agent 试运行失败" }, { status }), sessionId);
  }
}

