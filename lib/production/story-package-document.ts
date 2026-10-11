import type { z } from "zod";
import type { AssetVisualProfileSpec } from "@/lib/assets/visual-profile";

import {
  StoryPackageAssetsSchema,
  StoryPackageEpisodeBatchSchema,
  StoryPackageFirstEpisodeSchema,
  StoryPackagePlanSchema,
  type StoryPackage,
} from "./story-package-contract";

export type StoryPackageDocumentLocale = "zh" | "en";

export function renderStoryPackagePlan(
  plan: z.infer<typeof StoryPackagePlanSchema>,
  locale: StoryPackageDocumentLocale,
) {
  const en = locale === "en";
  const t = (zh: string, english: string) => (en ? english : zh);
  return [
    `# ${t("故事大纲", "Story outline")}`,
    `## ${plan.title}`,
    `> ${t("题材与结构：", "Genre and format: ")}${plan.format.structure} · ${plan.format.episodeCount}${t(" 集 × 每集 ", " episodes × ")}${plan.format.episodeDurationSeconds}${t(" 秒", " sec")} · ${plan.format.aspectRatio}`,
    "",
    `### ${t("概要设计", "Overview design")}`,
    `- **Logline：** ${plan.logline}`,
    `- **${t("核心看点", "Core appeals")}：**\n${plan.coreAppeal.map((item, index) => `  ${index + 1}. ${item}`).join("\n")}`,
    `- **${t("情绪曲线", "Emotional curve")}：** ${plan.emotionalCurve}`,
    "",
    `### ${t("故事简述", "Story synopsis")}`,
    plan.synopsis,
    "",
    `### ${t("背景设定", "Background setting")}`,
    `- **${t("故事背景", "Setting")}：** ${plan.backgroundSetting}`,
    `- **${t("关键规则", "World rules")}：**\n${plan.worldRules.map((rule, index) => `  ${index + 1}. **${rule.rule}** ${rule.consequence}`).join("\n")}`,
    "",
    `### ${t("全剧分段", "Series arcs")}`,
    ...plan.volumes.flatMap((volume) => [
      `#### ${t("第", "Part ")}${volume.volume}${en ? ` · ${volume.title}` : `：${volume.title}`}（${volume.episodeRange}）`,
      `- **${t("阶段目标", "Phase goal")}：** ${volume.phaseGoal}`,
      `- **${t("本段信息释放", "Information revealed")}：** ${volume.informationRelease}`,
      `- **${t("与其他段的区别", "Distinctiveness")}：** ${volume.distinctiveness}`,
      `- **${t("阶段高潮", "Climax")}：** ${volume.climax}`,
      `- **${t("卷尾钩子", "Ending hook")}：** ${volume.endingHook}`,
      volume.synopsis,
      "",
    ]),
    `### ${t("为什么能追", "Why keep watching")}`,
    ...plan.whyWatch.earlyEpisodes.map(
      (item) =>
        `- **${t("第", "Episode ")}${item.episodeNumber}${en ? "" : " 集"}：** ${item.moment} — ${item.questionRaised}`,
    ),
    `- **${t("为什么不能互换", "Why the episodes cannot be swapped")}：** ${plan.whyWatch.nonInterchangeabilityReason}`,
    "",
    `### ${t("创作禁区", "Creative prohibitions")}`,
    ...plan.creativeProhibitions.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

export function renderEpisodeBatch(
  batch: z.infer<typeof StoryPackageEpisodeBatchSchema>,
  locale: StoryPackageDocumentLocale,
) {
  const en = locale === "en";
  const t = (zh: string, english: string) => (en ? english : zh);
  const episodes = batch.episodeOutlines;
  if (!episodes.length) return "";
  const heading =
    episodes.length > 1
      ? `${t("第", "Episodes ")}${episodes[0]!.episodeNumber}-${episodes.at(-1)!.episodeNumber}${en ? "" : " 集大纲"}`
      : `${t("第", "Episode ")}${episodes[0]!.episodeNumber}${en ? " outline" : " 集大纲"}`;
  return [
    `### ${heading}`,
    ...episodes.flatMap((episode) => [
      `#### ${t("第", "Episode ")}${episode.episodeNumber}${en ? `: ${episode.title}` : ` 集 · ${episode.title}`}`,
      episode.summary,
      `- **${t("集尾钩子", "Ending hook")}：** ${episode.endingHook}`,
      `- **${t("埋下的线索", "Planted clue")}：** ${episode.plantedClue}`,
      `- **${t("对应回收", "Payoff")}：** ${episode.payoff}`,
      "",
    ]),
    `### ${t("钩子预设", "Hook setup")}`,
    ...batch.hooks.map(
      (hook) =>
        `- **${t("第", "Episode ")}${hook.episodeNumber}${en ? "" : " 集"}：** ${hook.hook} — ${t("引发问题", "Question raised")}：${hook.questionRaised}；${t("预期回收", "Promised payoff")}：${hook.promisedPayoff}`,
    ),
    "",
    `### ${t("伏笔预设", "Foreshadowing")}`,
    ...batch.foreshadowing.map(
      (clue) =>
        `- **${clue.clue}：** ${t("埋设", "Introduced")} ${clue.introducedAt}（${clue.introducedForm}）→ ${t("回收", "Paid off")} ${clue.payoffAt}：${clue.payoff}`,
    ),
    "",
    `### ${t("反转预设", "Reversal setup")}`,
    ...batch.reversals.map(
      (reversal) =>
        `- **${t("第", "Episode ")}${reversal.episodeNumber}${en ? "" : " 集"}：** ${reversal.reveal}（铺垫：${reversal.setup}）`,
    ),
    "",
  ].join("\n");
}

export function renderStoryPackageAssets(
  assets: z.infer<typeof StoryPackageAssetsSchema>,
  locale: StoryPackageDocumentLocale,
) {
  const en = locale === "en";
  const t = (zh: string, english: string) => (en ? english : zh);
  return [
    `## ${t("人物小传", "Character biographies")}`,
    ...assets.characters.flatMap((character) => [
      `### ${character.name}`,
      `> ${character.tags.join(" · ")}｜${character.role}`,
      `- **${t("人物设定", "Profile")}：** ${character.ageAndAppearance} ${character.personality} ${character.motivation}`,
      `- **${t("在本剧的作用", "Story function")}：** ${character.storyFunction}`,
      `- **${t("语言风格", "Voice style")}：** ${character.voiceStyle}`,
      `- **${t("说话的破绽", "Speaking tell")}：** ${character.speakingTell}`,
      `- **${t("设定记忆点", "Signature detail")}：** ${character.signatureDetail}`,
      `- **${t("弧光", "Arc")}：** ${character.arc}`,
      `- **${t("被逼急时怎么做", "Under pressure")}：** ${character.pressureBehavior}`,
      `- **${t("关系与称呼规则", "Relationships and forms of address")}：** ${character.relationships} ${character.addressingRules}`,
      `- **${t("首次出场 / 关键集次", "First / key episodes")}：** ${character.firstAppearanceEpisode} / ${character.keyEpisodes.join("、")}`,
      `- **Image prompt：** ${character.imagePrompt}`,
      ...renderVisualProfile(character.visualProfile, locale),
      "",
    ]),
    `## ${t("场景设计", "Location design")}`,
    ...assets.locations.flatMap((location) => [
      `### ${location.name}`,
      `> ${location.type}`,
      `- **${t("戏剧作用", "Story function")}：** ${location.storyFunction}`,
      `- **${t("空间对行动的限制", "Spatial constraints")}：** ${location.spatialRules}`,
      `- **${t("可复用动作位置", "Reusable blocking")}：** ${location.reusableActions}`,
      `- **${t("氛围 / 关键集次", "Atmosphere / key episodes")}：** ${location.atmosphere} / ${location.keyEpisodes.join("、")}`,
      `- **Image prompt：** ${location.imagePrompt}`,
      ...renderVisualProfile(location.visualProfile, locale),
      "",
    ]),
    `## ${t("道具设计", "Prop design")}`,
    ...(assets.props.length
      ? assets.props.flatMap((prop) => [
          `### ${prop.name}`,
          `> ${prop.type}`,
          `- **${t("戏剧作用", "Story function")}：** ${prop.storyFunction}`,
          `- **${t("外观", "Appearance")}：** ${prop.appearance}`,
          `- **${t("能力边界", "Capability limits")}：** ${prop.capabilities}；${prop.limits}`,
          `- **${t("代价", "Cost")}：** ${prop.costOrConsequence}`,
          `- **${t("首次出场 / 关键集次", "First / key episodes")}：** ${prop.firstAppearanceEpisode} / ${prop.keyEpisodes.join("、")}`,
          `- **Image prompt：** ${prop.imagePrompt}`,
          ...renderVisualProfile(prop.visualProfile, locale),
          "",
        ])
      : [`${t("本剧暂无关键道具。", "No key props are defined.")}`, ""]),
  ].join("\n");
}

function renderVisualProfile(
  profile: AssetVisualProfileSpec | undefined,
  locale: StoryPackageDocumentLocale,
) {
  if (!profile) return [];
  const en = locale === "en";
  const labels = en
    ? [
        ["Visual identity", profile.visualIdentity],
        ["Shape and structure", profile.shapeAndStructure],
        ["Surface and styling", profile.surfaceAndStyling],
        ["Color palette", profile.colorPalette],
        ["Lighting and presentation", profile.lightingAndPresentation],
        ["Signature details", profile.signatureDetails.join("; ")],
        ["Consistency rules", profile.consistencyRules.join("; ")],
        ["Negative prompt", profile.negativePrompt],
        ["Inference notes", profile.inferenceNotes.join("; ")],
      ]
    : [
        ["主体外观", profile.visualIdentity],
        ["形体与结构", profile.shapeAndStructure],
        ["造型与材质", profile.surfaceAndStyling],
        ["色彩方案", profile.colorPalette],
        ["参考图呈现", profile.lightingAndPresentation],
        ["识别细节", profile.signatureDetails.join("；")],
        ["一致性规则", profile.consistencyRules.join("；")],
        ["排除项", profile.negativePrompt],
        ["推断记录", profile.inferenceNotes.join("；")],
      ];
  return [
    `- **${en ? "Complete visual profile" : "完整视觉设定"}：**`,
    ...labels.map(([label, value]) => `  - **${label}：** ${value}`),
  ];
}

export function renderFirstEpisode(
  firstEpisode: z.infer<typeof StoryPackageFirstEpisodeSchema>["firstEpisode"],
  locale: StoryPackageDocumentLocale,
) {
  const en = locale === "en";
  const t = (zh: string, english: string) => (en ? english : zh);
  return [
    `## ${t("分集剧本", "Episode scripts")}`,
    `### ${t("第一集", "Episode 1")} · ${firstEpisode.title}`,
    `> ${firstEpisode.targetDurationSeconds}${t(" 秒", " sec")}`,
    firstEpisode.synopsis,
    `**${t("结尾钩子", "Ending hook")}：** ${firstEpisode.endingHook}`,
    "",
    ...firstEpisode.scenes.flatMap((scene) => [
      `#### ${scene.heading}`,
      `> ${t("场次", "Scene")} ${scene.sceneNumber}｜${scene.durationSeconds}${t(" 秒", " sec")}｜${scene.location}`,
      `**${t("出场人物", "Characters")}：** ${scene.characters.join("、")}  **${t("道具", "Props")}：** ${scene.props.join("、")}`,
      scene.action,
      ...scene.dialogue.map((line) => `> **${line.speaker}：** ${line.line}`),
      `- **${t("镜头", "Camera")}：** ${scene.camera}`,
      `- **${t("声音", "Sound")}：** ${scene.sound}`,
      `- **${t("场末状态", "End state")}：** ${scene.endState}`,
      `- **Image prompt：** ${scene.imagePrompt}`,
      `- **Video prompt：** ${scene.videoPrompt}`,
      `- **${t("参考图槽位", "Reference slots")}：** ${scene.imageReferenceSlots.map((slot) => `${slot.number}. ${slot.kind}：${slot.name}`).join("；")}`,
      "",
    ]),
  ].join("\n");
}

export function renderStoryPackageDocument(
  storyPackage: StoryPackage,
  locale: StoryPackageDocumentLocale,
) {
  const plan = renderStoryPackagePlan(storyPackage, locale);
  const batch = renderEpisodeBatch(
    {
      episodeOutlines: storyPackage.episodeOutlines,
      hooks: storyPackage.hooks,
      foreshadowing: storyPackage.foreshadowing,
      reversals: storyPackage.reversals,
    },
    locale,
  );
  return [
    plan,
    `### ${locale === "en" ? "Episode outlines" : "逐集大纲"}`,
    batch,
    renderStoryPackageAssets(storyPackage, locale),
    renderFirstEpisode(storyPackage.firstEpisode, locale),
  ].join("\n\n");
}
