import { z } from "zod";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { productionConfigurationPatchSchema } from "@/lib/production-configuration/contract";
import {
  ConfigurationError,
  readProductionConfiguration,
  mutateProductionConfiguration,
} from "@/lib/production-configuration/store";
import {
  AgentConfigurationError,
  getConfigurationAgentCatalog,
  validateConfigurationAgents,
} from "@/lib/production-configuration/agents";

const scopeSchema = z
  .object({
    projectId: z.string().min(1).max(200).optional(),
    episodeId: z.string().min(1).max(200).optional(),
    panelId: z.string().min(1).max(200).optional(),
  })
  .strict();
const mutationSchema = z
  .object({
    scope: scopeSchema,
    action: z.enum(["save", "publish", "restore"]),
    expectedRevision: z.number().int().nonnegative(),
    patch: productionConfigurationPatchSchema.optional(),
    restoreVersion: z.number().int().positive().optional(),
    note: z.string().max(1000).optional(),
  })
  .strict();
export async function GET(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  try {
    const url = new URL(request.url);
    const scope = scopeSchema.parse(
      Object.fromEntries(
        [...url.searchParams].filter(([key]) =>
          ["projectId", "episodeId", "panelId"].includes(key),
        ),
      ),
    );
    const configuration = await readProductionConfiguration(user.id, scope);
    return attachSessionCookie(
      Response.json({ configuration, agents: getConfigurationAgentCatalog() }),
      sessionId,
    );
  } catch (error) {
    return failure(error, sessionId);
  }
}
export async function PUT(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  try {
    const data = mutationSchema.parse(await request.json());
    if (data.patch) validateConfigurationAgents(data.patch);
    const configuration = await mutateProductionConfiguration({
      ...data,
      userId: user.id,
    });
    return attachSessionCookie(Response.json({ configuration }), sessionId);
  } catch (error) {
    return failure(error, sessionId);
  }
}
function failure(error: unknown, sessionId: string | null) {
  const status =
    error instanceof ConfigurationError
      ? error.status
      : error instanceof z.ZodError ||
          error instanceof AgentConfigurationError ||
          error instanceof SyntaxError
        ? 400
        : 500;
  if (status === 500) console.error("Production configuration failed", error);
  return attachSessionCookie(
    Response.json(
      {
        message:
          status === 500
            ? "制作配置服务暂时不可用，请稍后重试"
            : error instanceof Error
              ? error.message
              : "制作配置操作失败",
      },
      { status },
    ),
    sessionId,
  );
}
