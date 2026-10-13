import { z } from "zod";

export const soundPolicySchema = z
  .object({
    mode: z.enum(["native", "post", "silent"]),
    dialogue: z.boolean(),
    voiceover: z.boolean(),
    innerMonologue: z.boolean(),
    ambience: z.boolean(),
    effects: z.boolean(),
    music: z.enum(["off", "designed", "post"]),
    subtitles: z.enum(["post", "model", "off"]),
    voiceDirection: z.string().max(4000),
    ambienceDirection: z.string().max(4000),
    effectsDirection: z.string().max(4000),
    musicDirection: z.string().max(4000),
  })
  .strict();
export type SoundPolicy = z.infer<typeof soundPolicySchema>;
export const DEFAULT_SOUND_POLICY: SoundPolicy = {
  mode: "native",
  dialogue: true,
  voiceover: true,
  innerMonologue: true,
  ambience: true,
  effects: true,
  music: "designed",
  subtitles: "post",
  voiceDirection: "",
  ambienceDirection: "",
  effectsDirection: "",
  musicDirection: "",
};
export const agentConfigurationSchema = z
  .object({
    name: z.string().max(120).optional(),
    responsibility: z.string().max(4000).optional(),
    systemInstructions: z.string().max(16000).optional(),
    templateZh: z.string().max(60000).optional(),
    templateEn: z.string().max(60000).optional(),
    channelId: z.string().max(200).optional(),
    model: z.string().max(200).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxCorrections: z.number().int().min(0).max(2).optional(),
    disabledOperations: z.array(z.string().max(100)).max(50).optional(),
  })
  .strict();
export type AgentConfiguration = z.infer<typeof agentConfigurationSchema>;
export const workflowPolicySchema = z
  .object({
    retryMode: z.enum(["continue", "restart"]),
    requestTimeoutSeconds: z.number().int().min(10).max(3600),
    transportAttempts: z.number().int().min(1).max(5),
    maxCorrections: z.number().int().min(0).max(2),
    concurrency: z.number().int().min(1).max(8),
  })
  .strict();
export const DEFAULT_WORKFLOW_POLICY: z.infer<typeof workflowPolicySchema> = {
  retryMode: "restart",
  requestTimeoutSeconds: 600,
  transportAttempts: 1,
  maxCorrections: 0,
  concurrency: 2,
};
export const productionConfigurationPatchSchema = z
  .object({
    sound: soundPolicySchema.partial().optional(),
    agents: z
      .record(z.string().min(1).max(100), agentConfigurationSchema)
      .optional(),
    workflow: workflowPolicySchema.partial().optional(),
  })
  .strict();
export type ProductionConfigurationPatch = z.infer<
  typeof productionConfigurationPatchSchema
>;
export type ProductionConfiguration = {
  sound: SoundPolicy;
  agents: Record<string, AgentConfiguration>;
  workflow: z.infer<typeof workflowPolicySchema>;
};
export type ConfigurationScope = {
  projectId?: string;
  episodeId?: string;
  panelId?: string;
};
export type ProductionConfigurationSnapshot = ProductionConfiguration & {
  format: "production-configuration-v1";
  sources: Array<{ scopeKey: string; version: number; fields?: string[] }>;
};
export const configurationSnapshotSchema = z.object({
  format: z.literal("production-configuration-v1"),
  sound: soundPolicySchema,
  agents: z.record(z.string(), agentConfigurationSchema),
  workflow: workflowPolicySchema,
  sources: z.array(
    z.object({
      scopeKey: z.string(),
      version: z.number().int().nonnegative(),
      fields: z.array(z.string()).optional(),
    }),
  ),
});
export function configurationScopeKey(scope: ConfigurationScope) {
  if (scope.panelId && (!scope.episodeId || !scope.projectId))
    throw new Error("镜头设置必须包含所属项目和剧集");
  if (scope.episodeId && !scope.projectId)
    throw new Error("剧集设置必须包含所属项目");
  return scope.panelId
    ? `panel:${scope.panelId}`
    : scope.episodeId
      ? `episode:${scope.episodeId}`
      : scope.projectId
        ? `project:${scope.projectId}`
        : "user";
}
export function mergeProductionConfigurations(
  patches: ProductionConfigurationPatch[],
): ProductionConfiguration {
  const result: ProductionConfiguration = {
    sound: { ...DEFAULT_SOUND_POLICY },
    agents: {},
    workflow: { ...DEFAULT_WORKFLOW_POLICY },
  };
  for (const patch of patches) {
    Object.assign(result.sound, patch.sound);
    Object.assign(result.workflow, patch.workflow);
    for (const [key, value] of Object.entries(patch.agents ?? {}))
      result.agents[key] = { ...result.agents[key], ...value };
  }
  return result;
}
export function soundPolicyAudioMode(
  policy: SoundPolicy,
): "full" | "ambient_only" | "none" {
  if (policy.mode !== "native") return "none";
  if (policy.dialogue || policy.voiceover || policy.innerMonologue)
    return "full";
  return policy.ambience || policy.effects || policy.music === "designed"
    ? "ambient_only"
    : "none";
}

/** Shared contract for directors, prompt design and final video submission. */
export function soundPolicyInstructions(
  policy: SoundPolicy,
  locale: "zh" | "en" = "zh",
) {
  const en = locale === "en";
  const labels = en
    ? [
        "approved dialogue",
        "off-screen narration",
        "inner monologue",
        "environmental sound",
        "action effects",
      ]
    : ["对白", "画外音／旁白", "心声／内心独白", "环境声", "动作音效"];
  const enabled = [
    policy.dialogue,
    policy.voiceover,
    policy.innerMonologue,
    policy.ambience,
    policy.effects,
  ];
  const parts =
    policy.mode === "native"
      ? [
          en
            ? "Generate a complete audiovisual clip with native audio."
            : "生成完整声画视频，保留原生音轨。",
          ...labels.map((label, index) =>
            enabled[index]
              ? en
                ? `Include ${label} when present in the scene.`
                : `包含本镜已有的${label}。`
              : en
                ? `Do not generate ${label}.`
                : `不生成${label}。`,
          ),
          en
            ? "Keep voices clear and consistent. Do not invent or rewrite speech. Only visible dialogue speakers lip-sync; narration and inner monologue never make visible characters speak."
            : "人声清晰，角色音色一致，不得新增或改写台词；仅画面中说对白的角色做口型，画外音和心声不让画面角色开口。",
          policy.ambience && policy.effects
            ? en
              ? "Synchronize environmental sound and action effects to the scene."
              : "环境声、音效与场景和动作同步，声音连续。"
            : "",
          policy.music === "designed"
            ? en
              ? "Generate music only from an existing music design; otherwise no music."
              : "配乐仅按已有设计生成，没有配乐设计则不生成配乐。"
            : en
              ? "Do not generate music; music may be added in post."
              : "不生成配乐。",
          ...[
            policy.voiceDirection &&
            (policy.dialogue || policy.voiceover || policy.innerMonologue)
              ? policy.voiceDirection
              : "",
            policy.ambience ? policy.ambienceDirection : "",
            policy.effects ? policy.effectsDirection : "",
            policy.music === "designed" ? policy.musicDirection : "",
          ].filter(Boolean),
        ]
      : [
          policy.mode === "post"
            ? en
              ? "Generate silent footage. Speech and sound are added separately in post. Preserve timing and visible dialogue mouth performance; narration and inner monologue never require lip-sync."
              : "生成静音画面，声音由独立配音和后期合成；保留对白表演时序，画外音和心声不做口型。"
            : en
              ? "Generate silent footage without speech, ambience, effects or music."
              : "生成静音画面，不生成对白、画外音、心声、环境声、音效或配乐。",
        ];
  parts.push(
    policy.subtitles === "model"
      ? en
        ? "Render only approved speech as subtitles when supported. This is a prompt requirement, not a guaranteed subtitle parameter."
        : "仅为已有台词生成字幕；这是提示词要求，取决于模型能力。"
      : en
        ? "No generated subtitles or captions; subtitles are composed later when requested."
        : policy.subtitles === "post"
          ? "不生成字幕，字幕由项目后期合成。"
          : "不生成字幕。",
  );
  parts.push(en ? "No titles or watermarks." : "不生成标题或水印。");
  return parts.join("\n");
}
