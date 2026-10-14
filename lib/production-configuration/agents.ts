import { createHash } from "node:crypto";
import {
  PROMPT_CATALOG,
  getPromptTemplate,
  type RenderedPrompt,
} from "@/lib/prompts";
import {
  PRODUCTION_AGENT_CONTRACTS,
  readProductionTemplate,
  type ProductionPromptTask,
} from "@/lib/prompts/production-rules";
import type {
  ProductionConfigurationSnapshot,
  ProductionConfigurationPatch,
} from "./contract";
import { validateAgentTemplateVariables } from "./template-variables";

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
      taskScope: entry.agent.contextPolicy.scope,
      acceptanceCriteria: entry.agent.successCriteria.join("\n"),
      stopConditions: entry.agent.stopRules.join("\n"),
      styleRequirements: "",
      examples: "",
      qualityChecks: [...entry.agent.qualityGates],
      variables: [...entry.variables],
      templateZh: getPromptTemplate(id as keyof typeof PROMPT_CATALOG, "zh"),
      templateEn: getPromptTemplate(id as keyof typeof PROMPT_CATALOG, "en"),
      tools: [...entry.agent.tools],
    })),
    ...productionTasks.map((task) => ({
      id: `production_${task}`,
      name: task,
      responsibility: PRODUCTION_AGENT_CONTRACTS[task].responsibility,
      taskScope: PRODUCTION_AGENT_CONTRACTS[task].taskScope,
      acceptanceCriteria: PRODUCTION_AGENT_CONTRACTS[task].acceptanceCriteria.join("\n"),
      stopConditions: PRODUCTION_AGENT_CONTRACTS[task].stopConditions,
      styleRequirements: "",
      examples: "",
      qualityChecks: [...PRODUCTION_AGENT_CONTRACTS[task].qualityChecks],
      variables: ["task_snapshot"],
      templateZh: `${readProductionTemplate(task)}\n\n{{task_snapshot}}`,
      templateEn: `${readProductionTemplate(task)}\n\n{{task_snapshot}}`,
      tools: [] as string[],
    })),
  ];
}

export function getConfiguredAgentForPrompt(
  prompt: RenderedPrompt,
  configuration: ProductionConfigurationSnapshot,
) {
  const taskAgent = configuration.agents[prompt.agentId];
  const promptAgent = configuration.agents[prompt.id];
  if (taskAgent && promptAgent) {
    const merged = { ...promptAgent, ...taskAgent };
    for (const key of [
      "responsibility",
      "taskScope",
      "systemInstructions",
      "acceptanceCriteria",
      "stopConditions",
      "styleRequirements",
      "examples",
    ] as const) {
      const values = [promptAgent[key], taskAgent[key]]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value));
      if (values.length) merged[key] = [...new Set(values)].join("\n\n");
    }
    if (promptAgent.qualityChecks || taskAgent.qualityChecks) {
      merged.qualityChecks = [
        ...new Set([
          ...(promptAgent.qualityChecks ?? []),
          ...(taskAgent.qualityChecks ?? []),
        ]),
      ];
    }
    return merged;
  }
  return taskAgent ?? promptAgent;
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
    if (Boolean(agent.fallbackChannelId) !== Boolean(agent.fallbackModel))
      throw new AgentConfigurationError(
        `${id}：备用模型和渠道必须同时指定，或同时继承`,
      );
    if (
      agent.channelId &&
      agent.model &&
      agent.fallbackChannelId === agent.channelId &&
      agent.fallbackModel === agent.model
    )
      throw new AgentConfigurationError(`${id}：备用模型必须与主模型不同`);
    const unknownTools = agent.disabledOperations?.filter(
      (tool) => !entry.tools.includes(tool),
    );
    if (unknownTools?.length)
      throw new AgentConfigurationError(
        `${id}：未实现的操作 ${unknownTools.join("、")}`,
      );
  }
  const templateError = validateAgentTemplateVariables(patch.agents ?? {}, catalog);
  if (templateError) throw new AgentConfigurationError(templateError);
}
export function applyConfiguredAgentPrompt(
  prompt: RenderedPrompt,
  configuration: ProductionConfigurationSnapshot,
): RenderedPrompt {
  const agent = getConfiguredAgentForPrompt(prompt, configuration);
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
    agent.taskScope,
    agent.systemInstructions,
    agent.acceptanceCriteria,
    agent.stopConditions,
    agent.styleRequirements,
    agent.examples,
    ...(agent.qualityChecks ?? []),
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
