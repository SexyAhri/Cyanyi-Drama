import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { validateConfigurationAgents } from "./agents";
import {
  configurationScopeKey,
  mergeProductionConfigurations,
  productionConfigurationPatchSchema,
  type ConfigurationScope,
  type ProductionConfigurationPatch,
  type ProductionConfigurationSnapshot,
} from "./contract";

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
    !(await prisma.project.count({ where: { id: scope.projectId, userId } }))
  )
    throw new ConfigurationError("项目不存在", 404);
  if (
    scope.episodeId &&
    !(await prisma.episode.count({
      where: { id: scope.episodeId, projectId: scope.projectId },
    }))
  )
    throw new ConfigurationError("剧集不存在", 404);
  if (
    scope.panelId &&
    !(await prisma.storyboardPanel.count({
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
): Promise<ProductionConfigurationSnapshot> {
  const keys = [
    "user",
    ...(scope.projectId ? [`project:${scope.projectId}`] : []),
    ...(scope.episodeId ? [`episode:${scope.episodeId}`] : []),
    ...(scope.panelId ? [`panel:${scope.panelId}`] : []),
  ];
  const rows = await prisma.productionConfiguration.findMany({
    where: {
      userId,
      scopeKey: { in: keys },
      published: { not: Prisma.DbNull },
    },
  });
  const ordered = keys.flatMap((key) =>
    rows.filter((row) => row.scopeKey === key),
  );
  return {
    ...mergeProductionConfigurations(
      ordered.map((row) =>
        productionConfigurationPatchSchema.parse(row.published),
      ),
    ),
    format: "production-configuration-v1",
    sources: ordered.map((row) => ({
      scopeKey: row.scopeKey,
      version: row.version,
      fields: configurationFields(productionConfigurationPatchSchema.parse(row.published)),
    })),
  };
}
export async function readProductionConfiguration(
  userId: string,
  scope: ConfigurationScope,
) {
  await assertConfigurationScope(userId, scope);
  const scopeKey = configurationScopeKey(scope);
  const parentScope = scope.panelId ? { projectId: scope.projectId, episodeId: scope.episodeId }
    : scope.episodeId ? { projectId: scope.projectId } : {};
  const [row, effective, inherited] = await Promise.all([
    prisma.productionConfiguration.findUnique({
      where: { userId_scopeKey: { userId, scopeKey } },
    }),
    resolveProductionConfiguration(userId, scope),
    scopeKey === "user" ? Promise.resolve({ ...mergeProductionConfigurations([]), format: "production-configuration-v1" as const, sources: [] })
      : resolveProductionConfiguration(userId, parentScope),
  ]);
  return {
    scopeKey,
    revision: row?.revision ?? 0,
    version: row?.version ?? 0,
    draft: productionConfigurationPatchSchema.parse(row?.draft ?? {}),
    published: row?.published
      ? productionConfigurationPatchSchema.parse(row.published)
      : null,
    history: row?.history ?? [],
    effective,
    inherited,
  };
}

function configurationFields(patch: ProductionConfigurationPatch) {
  return [
    ...Object.keys(patch.sound ?? {}).map(key => `sound.${key}`),
    ...Object.keys(patch.workflow ?? {}).map(key => `workflow.${key}`),
    ...Object.entries(patch.agents ?? {}).flatMap(([id, agent]) => Object.keys(agent).map(key => `agents.${id}.${key}`)),
  ];
}
export async function mutateProductionConfiguration(input: {
  userId: string;
  scope: ConfigurationScope;
  expectedRevision: number;
  action: "save" | "publish" | "restore";
  patch?: ProductionConfigurationPatch;
  restoreVersion?: number;
  note?: string;
}) {
  await assertConfigurationScope(input.userId, input.scope);
  if (input.patch) {
    validateConfigurationAgents(input.patch);
    for (const agent of Object.values(input.patch.agents ?? {})) {
      if (agent.channelId && agent.model && !(await prisma.providerModel.count({ where: {
        channelId: agent.channelId, modelId: agent.model, selected: true,
        channel: { ...accessibleChannelWhere(input.userId), protocol: { in: ["openai-compatible", "volcengine-ark"] } },
      } }))) throw new ConfigurationError("Agent 模型未配置、渠道不可访问或协议不支持文本请求", 400);
    }
  }
  const scopeKey = configurationScopeKey(input.scope);
  await prisma.$transaction(async (tx) => {
    const row = await tx.productionConfiguration.upsert({
      where: { userId_scopeKey: { userId: input.userId, scopeKey } },
      create: { userId: input.userId, scopeKey },
      update: {},
    });
    if (row.revision !== input.expectedRevision)
      throw new ConfigurationError("设置已被更新，请重新加载后比较修改", 409);
    const history = Array.isArray(row.history) ? row.history : [];
    let patch = productionConfigurationPatchSchema.parse(
      input.patch ?? row.draft,
    );
    if (input.action === "restore") {
      const prior = history.find(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          item.version === input.restoreVersion,
      );
      if (!prior || typeof prior !== "object" || Array.isArray(prior))
        throw new ConfigurationError("配置版本不存在", 404);
      patch = productionConfigurationPatchSchema.parse(prior.configuration);
    }
    const publish = input.action !== "save";
    const configuration = JSON.parse(
      JSON.stringify(patch),
    ) as Prisma.InputJsonValue;
    const nextHistory = publish
      ? [
          ...history,
          {
            version: row.version + 1,
            configuration,
            note: input.note?.trim() ?? "",
            createdAt: new Date().toISOString(),
            authorId: input.userId,
          },
        ]
      : history;
    const updated = await tx.productionConfiguration.updateMany({
      where: { id: row.id, revision: input.expectedRevision },
      data: {
        draft: configuration,
        revision: { increment: 1 },
        ...(publish
          ? {
              published: configuration,
              version: { increment: 1 },
              publishedAt: new Date(),
              history: nextHistory as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
    if (!updated.count)
      throw new ConfigurationError("设置已被更新，请重新加载后比较修改", 409);
  });
  return readProductionConfiguration(input.userId, input.scope);
}
