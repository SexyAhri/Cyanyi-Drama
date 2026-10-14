import { z } from "zod";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { configurationScopeSchema } from "@/lib/production-configuration/contract";
import {
  managementConfigurationPatchSchema,
  managementValues,
} from "@/lib/production-configuration/management";
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

const scopeSchema = configurationScopeSchema;
const mutationSchema = z
  .object({
    scope: scopeSchema,
    action: z.enum(["save", "publish"]),
    expectedRevision: z.number().int().nonnegative(),
    patch: managementConfigurationPatchSchema,
    section: z.enum(["agents", "sound"]),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.section) {
      if (
        !["save", "publish"].includes(data.action) ||
        !data.patch ||
        Object.keys(data.patch).some((key) => key !== data.section)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "分项管理只能保存或发布当前配置项",
        });
      }
      if (data.section === "agents" && data.scope.projectId) {
        ctx.addIssue({ code: "custom", message: "Agent 管理只支持全局范围" });
      }
      if (
        data.section === "sound" &&
        Object.keys(data.patch?.sound ?? {}).some((key) => key !== "mode")
      ) {
        ctx.addIssue({
          code: "custom",
          message: "声音制作方式管理只能修改制作方式",
        });
      }
    }
  });
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
      Response.json({
        configuration: managementRecord(configuration),
        agents: getConfigurationAgentCatalog(),
      }),
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
    return attachSessionCookie(
      Response.json({ configuration: managementRecord(configuration) }),
      sessionId,
    );
  } catch (error) {
    return failure(error, sessionId);
  }
}
function managementRecord(
  record: Awaited<ReturnType<typeof readProductionConfiguration>>,
) {
  return {
    ...record,
    effective: managementValues(record.effective),
    inherited: managementValues(record.inherited),
  };
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
