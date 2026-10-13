import { createHash } from "node:crypto";
import {
  PROMPT_CATALOG,
  getPromptTemplate,
  type RenderedPrompt,
} from "@/lib/prompts";
import {
  readProductionTemplate,
  type ProductionPromptTask,
} from "@/lib/prompts/production-rules";
import type {
  ProductionConfigurationSnapshot,
  ProductionConfigurationPatch,
} from "./contract";

const productionTasks: ProductionPromptTask[] = [
  "storyboard-generation",
  "storyboard-review",
  "storyboard-repair",
  "video-prompt-generation",
  "asset-prompt-generation",
  "script-generation",
];
export class AgentConfigurationError extends Error {}
export function getConfigurationAgentCatalog() {
  return [
    ...Object.entries(PROMPT_CATALOG).map(([id, entry]) => ({
      id,
      name: entry.agent.id,
      responsibility: entry.agent.responsibility,
      variables: [...entry.variables],
      templateZh: getPromptTemplate(id as keyof typeof PROMPT_CATALOG, "zh"),
      templateEn: getPromptTemplate(id as keyof typeof PROMPT_CATALOG, "en"),
      tools: [...entry.agent.tools],
    })),
    ...productionTasks.map((task) => ({
      id: `production_${task}`,
      name: task,
      responsibility: "执行制作任务，并遵守当前输入和输出合同。",
      variables: ["task_snapshot"],
      templateZh: `${readProductionTemplate(task)}\n\n{{task_snapshot}}`,
      templateEn: `${readProductionTemplate(task)}\n\n{{task_snapshot}}`,
      tools: [] as string[],
    })),
  ];
}
export function validateConfigurationAgents(
  patch: ProductionConfigurationPatch,
) {
  const catalog = getConfigurationAgentCatalog();
  for (const [id, agent] of Object.entries(patch.agents ?? {})) {
    const entry = catalog.find((item) => item.id === id);
    if (!entry) throw new AgentConfigurationError(`未知 Agent：${id}`);
    if (Boolean(agent.channelId) !== Boolean(agent.model))
      throw new AgentConfigurationError(
        `${id}：模型和渠道必须同时指定，或同时继承`,
      );
    const unknownTools = agent.disabledOperations?.filter(
      (tool) => !entry.tools.includes(tool),
    );
    if (unknownTools?.length)
      throw new AgentConfigurationError(
        `${id}：未实现的操作 ${unknownTools.join("、")}`,
      );
    for (const template of [agent.templateZh, agent.templateEn]) {
      if (!template?.trim()) continue;
      const variables = new Set(
        Array.from(
          template.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g),
          (match) => match[1],
        ),
      );
      const unknown = [...variables].filter(
        (key) => !entry.variables.includes(key),
      );
      const missing = entry.variables.filter((key) => !variables.has(key));
      if (unknown.length || missing.length)
        throw new AgentConfigurationError(
          `${id}：${unknown.length ? `未知变量 ${unknown.join("、")}` : ""}${missing.length ? ` 缺少变量 ${missing.join("、")}` : ""}`,
        );
    }
  }
}
export function applyConfiguredAgentPrompt(
  prompt: RenderedPrompt,
  configuration: ProductionConfigurationSnapshot,
): RenderedPrompt {
  const agent =
    configuration.agents[prompt.agentId] ?? configuration.agents[prompt.id];
  if (!agent) return prompt;
  const template = prompt.locale === "en" ? agent.templateEn : agent.templateZh;
  let text = prompt.text;
  if (template?.trim()) {
    const variables = prompt.variables ?? {};
    text = template.replace(
      /\{\{([A-Za-z0-9_]+)\}\}/g,
      (_match, key: string) => {
        if (!(key in variables))
          throw new Error(`AGENT_TEMPLATE_VARIABLE_MISSING:${key}`);
        return variables[key];
      },
    );
    // The platform contract remains authoritative even when the editable task
    // template changes. Source snapshots and schema remain present in the input.
    if (prompt.platformContract) text += `\n\n${prompt.platformContract}`;
  }
  const systemText = [
    prompt.systemText,
    agent.responsibility,
    agent.systemInstructions,
  ]
    .filter(Boolean)
    .join("\n\n");
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  return {
    ...prompt,
    text,
    systemText,
    systemHash: hash(systemText),
    templateHash: hash(text),
    maxSemanticCorrections:
      agent.maxCorrections ?? prompt.maxSemanticCorrections,
    versionHash: hash(
      JSON.stringify({
        original: prompt.versionHash,
        text,
        systemText,
        agent,
        sources: configuration.sources,
      }),
    ),
  };
}
