import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { validateConfigurationAgents } from "./agents";
import { markConfigurationAssetsStale } from "./invalidation";
import { PRODUCTION_DEFAULTS_VERSION } from "./defaults-version";
import {
  configurationScopeKey,
  mergeProductionConfigurations,
  type ConfigurationScope,
  type ProductionConfigurationPatch,
  type ProductionConfigurationSnapshot,
} from "./contract";
import {
  managementConfigurationPatchSchema,
  retainedConfiguration,
  replaceManagementSection,
  type ProductionManagementSection,
} from "./management";

export class ConfigurationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export async function assertConfigurationScope(
  userId: string,
  scope: ConfigurationScope,
  client: Pick<
    Prisma.TransactionClient,
    "project" | "episode" | "storyboardPanel"
  > = prisma,
) {
  try {
    configurationScopeKey(scope);
  } catch (error) {
    throw new ConfigurationError(
      error instanceof Error ? error.message : "配置范围不正确",
    );
  }
  if (
    scope.projectId &&
    !(await client.project.count({ where: { id: scope.projectId, userId } }))
  )
    throw new ConfigurationError("项目不存在", 404);
  if (
    scope.episodeId &&
    !(await client.episode.count({
      where: { id: scope.episodeId, projectId: scope.projectId },
    }))
  )
    throw new ConfigurationError("剧集不存在", 404);
  if (
    scope.panelId &&
    !(await client.storyboardPanel.count({
      where: {
        id: scope.panelId,
        storyboard: { projectId: scope.projectId, episodeId: scope.episodeId },
      },
    }))
  )
    throw new ConfigurationError("镜头不存在", 404);
}
export async function resolveProductionConfiguration(
  userId: string,
  scope: ConfigurationScope = {},
  client: Pick<Prisma.TransactionClient, "productionConfiguration"> = prisma,
): Promise<ProductionConfigurationSnapshot> {
  const keys = [
    "user",
    ...(scope.projectId ? [`project:${scope.projectId}`] : []),
    ...(scope.episodeId ? [`episode:${scope.episodeId}`] : []),
    ...(scope.panelId ? [`panel:${scope.panelId}`] : []),
  ];
  const rows = await client.productionConfiguration.findMany({
    where: {
      userId,
      scopeKey: { in: keys },
      published: { not: Prisma.DbNull },
    },
  });
  const ordered = keys.flatMap((key) =>
    rows.filter((row) => row.scopeKey === key),
  );
  const patches = ordered.map((row) =>
    retainedConfiguration(row.published, row.scopeKey),
  );
  return {
    defaultsVersion: PRODUCTION_DEFAULTS_VERSION,
    ...mergeProductionConfigurations(patches),
    format: "production-configuration-v1",
    sources: ordered.map((row, index) => ({
      scopeKey: row.scopeKey,
      version: row.version,
      fields: configurationFields(patches[index]),
    })),
  };
}
export async function readProductionConfiguration(
  userId: string,
  scope: ConfigurationScope,
) {
  await assertConfigurationScope(userId, scope);
  const scopeKey = configurationScopeKey(scope);
  const parentScope = scope.panelId
    ? { projectId: scope.projectId, episodeId: scope.episodeId }
    : scope.episodeId
      ? { projectId: scope.projectId }
      : {};
  const [row, effective, inherited] = await Promise.all([
    prisma.productionConfiguration.findUnique({
      where: { userId_scopeKey: { userId, scopeKey } },
    }),
    resolveProductionConfiguration(userId, scope),
    scopeKey === "user"
      ? Promise.resolve({
          ...mergeProductionConfigurations([]),
          format: "production-configuration-v1" as const,
          sources: [],
        })
      : resolveProductionConfiguration(userId, parentScope),
  ]);
  return {
    scopeKey,
    revision: row?.revision ?? 0,
    version: row?.version ?? 0,
    draft: retainedConfiguration(row?.draft, scopeKey),
    published: row?.published
      ? retainedConfiguration(row.published, scopeKey)
      : null,
    effective,
    inherited,
  };
}

function configurationFields(patch: ProductionConfigurationPatch) {
  return [
    ...Object.keys(patch.sound ?? {}).map((key) => `sound.${key}`),
    ...Object.entries(patch.agents ?? {}).flatMap(([id, agent]) =>
      Object.keys(agent).map((key) => `agents.${id}.${key}`),
    ),
  ];
}
export async function validateManagementConfiguration(
  userId: string,
  value: unknown,
  client: Pick<Prisma.TransactionClient, "providerModel"> = prisma,
) {
  const patch = managementConfigurationPatchSchema.parse(value);
  validateConfigurationAgents(patch);
  for (const agent of Object.values(patch.agents ?? {})) {
    for (const selection of [
      { channelId: agent.channelId, model: agent.model, label: "Agent 主模型" },
      {
        channelId: agent.fallbackChannelId,
        model: agent.fallbackModel,
        label: "Agent 备用模型",
      },
    ]) {
      if (
        selection.channelId &&
        selection.model &&
        !(await client.providerModel.count({
          where: {
            channelId: selection.channelId,
            modelId: selection.model,
            selected: true,
            channel: {
              ...accessibleChannelWhere(userId),
              protocol: { in: ["openai-compatible", "volcengine-ark"] },
            },
          },
        }))
      )
        throw new ConfigurationError(
          `${selection.label}未配置、渠道不可访问或协议不支持文本请求`,
          400,
        );
    }
  }
  return patch;
}
export async function mutateProductionConfiguration(input: {
  userId: string;
  scope: ConfigurationScope;
  expectedRevision: number;
  action: "save" | "publish";
  patch: ProductionConfigurationPatch;
  section: ProductionManagementSection;
}) {
  if (
    !["agents", "sound"].includes(input.section) ||
    !["save", "publish"].includes(input.action) ||
    !input.patch ||
    Object.keys(input.patch).some((key) => key !== input.section)
  )
    throw new ConfigurationError("分项管理只能保存或发布当前配置项");
  if (input.section === "agents" && input.scope.projectId)
    throw new ConfigurationError("Agent 管理只支持全局范围");
  if (
    input.section === "sound" &&
    Object.keys(input.patch?.sound ?? {}).some((key) => key !== "mode")
  )
    throw new ConfigurationError("声音制作方式管理只能修改制作方式");
  await assertConfigurationScope(input.userId, input.scope);
  await validateManagementConfiguration(input.userId, input.patch);
  const scopeKey = configurationScopeKey(input.scope);
  await prisma.$transaction(
    async (tx) => {
      const row = await tx.productionConfiguration.upsert({
        where: { userId_scopeKey: { userId: input.userId, scopeKey } },
        create: { userId: input.userId, scopeKey },
        update: {},
      });
      if (row.revision !== input.expectedRevision)
        throw new ConfigurationError("设置已被更新，请重新加载后比较修改", 409);
      const savedDraft = replaceManagementSection(
        retainedConfiguration(row.draft, scopeKey),
        input.patch,
        input.section,
      );
      const publish = input.action === "publish";
      const patch = publish
        ? replaceManagementSection(
            retainedConfiguration(row.published, scopeKey),
            input.patch,
            input.section,
          )
        : savedDraft;
      const configuration = JSON.parse(
        JSON.stringify(patch),
      ) as Prisma.InputJsonValue;
      const updated = await tx.productionConfiguration.updateMany({
        where: { id: row.id, revision: input.expectedRevision },
        data: {
          draft: JSON.parse(
            JSON.stringify(savedDraft),
          ) as Prisma.InputJsonValue,
          revision: { increment: 1 },
          ...(publish
            ? {
                published: configuration,
                version: { increment: 1 },
                publishedAt: new Date(),
              }
            : {}),
        },
      });
      if (!updated.count)
        throw new ConfigurationError("设置已被更新，请重新加载后比较修改", 409);
      if (publish)
        await markConfigurationAssetsStale(tx, input.userId, input.scope);
    },
    {
      timeout: 30_000,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
  return readProductionConfiguration(input.userId, input.scope);
}
