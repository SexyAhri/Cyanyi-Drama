import type { ProductionDeliverableRecord } from "../types";
import type { StudioLocale } from "../types";

type DeliverableUseMode = "automatic" | "reference";

type DeliverableGuidance = {
  purpose: string;
  usedBy: string;
  mode: DeliverableUseMode;
  dependencyTypes: string[];
};

type LocalizedDeliverableGuidance = {
  purpose: Record<StudioLocale, string>;
  usedBy: Record<StudioLocale, string>;
  mode: DeliverableUseMode;
  dependencyTypes: readonly string[];
};

const guidance = {
  creative_brief: guide("明确改编范围、受众、叙事重心和不可偏离项。", "Defines adaptation scope, audience, narrative focus, and non-negotiables.", "剧本改编、世界观整理和视觉方向", "Screenplay adaptation, world rules, and visual direction", "reference", []),
  production_bible: guide("统一集长、画幅、模型、版本和验收规则。", "Defines episode length, aspect ratio, models, versions, and acceptance rules.", "批量生成、成本控制和最终验收", "Batch generation, cost control, and final acceptance", "reference", ["creative_brief"]),
  production_control: guide("安排集数、预算、批次和审批节点。", "Plans episodes, budget, batches, and approval checkpoints.", "制片控制台和批量审批", "Production control and batch approval", "automatic", ["creative_brief", "production_bible"]),
  story_bible: guide("锁定世界观、势力、境界、功法、角色关系和剧情事实。", "Locks world lore, factions, realms, techniques, relationships, and story facts.", "剧本与分镜提示词中的世界观/战力约束", "World and power constraints in screenplay and storyboard prompts", "automatic", ["creative_brief"]),
  screenplay_lock: guide("形成对白、动作、场次完整且可以直接拆镜的定稿。", "Produces a dialogue-, action-, and scene-complete script ready for storyboarding.", "拆解、分镜、台词提取和声音模型", "Breakdown, storyboards, dialogue extraction, and voice generation", "reference", ["story_bible"]),
  script_breakdown: guide("列出每场需要的角色、场景、道具、服装、技能与特效。", "Lists cast, locations, props, wardrobe, skills, and effects required per scene.", "资产生成、连续性检查和镜头排期", "Asset generation, continuity checks, and shot scheduling", "reference", ["screenplay_lock", "story_bible"]),
  scene_schedule: guide("按场景和依赖安排素材及镜头生成顺序。", "Orders asset and shot generation by scene and dependency.", "批量镜头生产", "Batch shot production", "reference", ["script_breakdown"]),
  continuity_bible: guide("记录人物站位、手部、道具、服装、伤势和画面方向。", "Tracks blocking, hands, props, wardrobe, injuries, and screen direction.", "分镜连续状态与镜头质检", "Storyboard continuity states and shot QC", "reference", ["screenplay_lock", "script_breakdown"]),
  visual_bible: guide("统一画风、材质、光影、构图和世界视觉母题。", "Unifies style, materials, lighting, composition, and world visual motifs.", "角色、场景、道具、分镜和镜头生成", "Character, environment, prop, storyboard, and shot generation", "reference", ["creative_brief", "story_bible"]),
  color_script: guide("规划每场的主色、对比度、光源和情绪过渡。", "Plans palette, contrast, light sources, and emotional progression by scene.", "分镜摄影规则、镜头生成和调色", "Storyboard cinematography, shot generation, and grading", "reference", ["visual_bible", "screenplay_lock"]),
  character_design: guide("固定角色脸型、体态、服装、境界外显和表情动作边界。", "Locks face, body, wardrobe, visible realm traits, and expression/action range.", "角色参考图和所有含该角色的镜头", "Character references and every shot containing that character", "reference", ["visual_bible", "story_bible"]),
  environment_design: guide("固定场景地图、地貌建筑、尺度、光源和可破坏要素。", "Locks geography, architecture, scale, light sources, and destructible elements.", "场景参考图、运镜和技能环境反馈", "Environment references, camera blocking, and skill interaction", "reference", ["visual_bible", "story_bible"]),
  prop_costume_design: guide("固定关键道具、武器、服装的造型、材质和跨镜状态。", "Locks form, material, and cross-shot state for props, weapons, and wardrobe.", "资产参考图、分镜连续性和镜头生成", "Asset references, storyboard continuity, and shot generation", "reference", ["visual_bible", "script_breakdown"]),
  directors_treatment: guide("明确本集节奏、视角、场景规模和重点段落的处理方式。", "Defines episode rhythm, viewpoint, scale, and treatment of key sequences.", "走位、摄影和分镜", "Blocking, cinematography, and storyboards", "reference", ["screenplay_lock", "visual_bible"]),
  blocking: guide("拆清人物走位、打斗路线、攻防因果、命中反应和收势。", "Maps blocking, fight paths, attack-defense causality, impacts, and recovery.", "动作分镜、VFX 与 Foley 时间点", "Action storyboards, VFX, and Foley timing", "reference", ["screenplay_lock", "continuity_bible"]),
  shot_list: guide("把剧本变成可逐镜生成的镜头清单。", "Turns the script into a shot-by-shot generation list.", "镜头生成、VFX 拆解和声音时间表", "Shot generation, VFX breakdown, and sound cues", "reference", ["screenplay_lock", "blocking"]),
  cinematography_plan: guide("定义景别、机位、焦段、运镜、光影和轴线。", "Defines shot size, camera, lens, movement, lighting, and axis.", "分镜细化和图/视频生成提示词", "Storyboard refinement and image/video prompts", "reference", ["shot_list", "visual_bible", "color_script"]),
  performance_plan: guide("定义表情、微动作、发力链、台词口型和无声反应。", "Defines expression, micro-action, kinetic chain, lip-sync, and silent reaction.", "分镜细化、角色配音和口型", "Storyboard refinement, voice generation, and lip sync", "reference", ["screenplay_lock", "blocking"]),
  previs: guide("汇总镜头、走位、摄影、表演、VFX/SFX 节拍进行预演。", "Combines shots, blocking, camera, performance, and VFX/SFX beats for previs.", "动态分镜与正式镜头生产", "Animatic and final shot production", "reference", ["shot_list", "cinematography_plan", "performance_plan"]),
  animatic: guide("按时长、台词和动作节拍试剪整集。", "Pre-edits the episode using shot timing, dialogue, and action beats.", "镜头时长、配音、音效和成片节奏", "Shot duration, voice, sound, and final pacing", "reference", ["previs"]),
  shot_package: guide("汇总单镜头所需参考、提示词、首尾状态和模型参数。", "Packages references, prompts, boundary states, and model settings per shot.", "图像/视频模型任务", "Image and video generation tasks", "automatic", ["animatic", "shot_list"]),
  selects: guide("确定每镜采用的生成版本和备用版本。", "Selects the approved and alternate generation for each shot.", "VFX、剪辑和声音后期", "VFX, editorial, and sound post", "reference", ["shot_package"]),
  shot_qc: guide("记录角色一致性、动作连续、口型、画面和技术问题。", "Records identity, motion, lip-sync, visual, and technical issues.", "返工和镜头锁定", "Rework and shot lock", "reference", ["selects"]),
  vfx_breakdown: guide("列出技能、武器轨迹、冲击、元素、破坏和环境交互镜头。", "Lists skill, weapon trail, impact, elemental, destruction, and environment shots.", "单镜头特效制作单", "Per-shot VFX work orders", "reference", ["shot_list", "blocking"]),
  vfx_shot_package: guide("定义单镜头特效元素、时间点、来源、合成和质检。", "Defines per-shot elements, timing, sources, composite, and QC.", "VFX Element 与 Comp 生成任务", "VFX element and composite generation tasks", "automatic", ["vfx_breakdown", "selects"]),
  composite_qc: guide("检查遮罩、跟踪、光照、色彩、颗粒和整体融合。", "Checks mattes, tracking, lighting, color, grain, and integration.", "画面锁定和母版", "Picture lock and mastering", "reference", ["vfx_shot_package"]),
  dialogue_adr: guide("管理角色配音、内心独白、补录和口型偏移。", "Manages character voices, inner monologue, ADR, and sync offsets.", "声音后期包和口型合成", "Sound post package and lip-sync composite", "reference", ["screenplay_lock", "animatic"]),
  sfx_foley: guide("整理动作、武器、能量、命中、环境和破坏声。", "Organizes action, weapon, energy, impact, environment, and destruction sound.", "声音后期包的 effects 时间线", "The effects timeline in the sound post package", "automatic", ["animatic", "vfx_breakdown"]),
  music_cue_sheet: guide("按剧情节拍规划音乐进入、退出和版权状态。", "Plans music entries, exits, and rights by story beat.", "声音混录", "Sound mix", "reference", ["animatic"]),
  cue_sheet: guide("汇总对白、环境声、动作音效和音乐的时间点。", "Combines dialogue, ambience, action effects, and music timing.", "整集声音混录", "Episode sound mix", "reference", ["dialogue_adr", "sfx_foley", "music_cue_sheet"]),
  sound_mix: guide("平衡独立角色配音、视频环境声、动作音效和音乐。", "Balances separate character voice, video ambience, action effects, and music.", "成片声音轨和母版", "Final audio track and master", "reference", ["cue_sheet"]),
  sound_post_package: guide("保存可编辑的配音、SFX/Foley、音乐、混音和 QC 数据。", "Stores editable voice, SFX/Foley, music, mix, and QC data.", "声音工作台版本历史与最终混音", "Sound workspace history and final mix", "automatic", ["dialogue_adr", "sfx_foley", "music_cue_sheet"]),
  edit_decision_list: guide("记录镜头顺序、入出点和采用素材。", "Records shot order, in/out points, and selected media.", "画面锁定、调色和 Online", "Picture lock, grading, and online", "automatic", ["selects"]),
  picture_lock: guide("锁定不再改动时长和顺序的画面版本。", "Locks picture timing and order.", "最终声音、调色、字幕和母版", "Final sound, grading, subtitles, and master", "reference", ["edit_decision_list", "composite_qc"]),
  color_master: guide("输出统一色彩空间和最终视觉风格。", "Outputs the final look in a controlled color space.", "Online 母版", "Online master", "reference", ["picture_lock", "color_script"]),
  online_master: guide("合成最终画面、字幕和技术格式。", "Combines final picture, subtitles, and technical format.", "后期母版包", "Post master package", "reference", ["picture_lock", "color_master"]),
  post_master_package: guide("保存 EDL、调色、Online、字幕和 QC 的可验证数据。", "Stores verifiable EDL, grade, online, subtitle, and QC data.", "交付工作台和母版验收", "Delivery workspace and master acceptance", "automatic", ["online_master", "sound_mix"]),
  qc_report: guide("汇总画面、声音、字幕和编码问题。", "Summarizes picture, sound, subtitle, and encode issues.", "返修和最终验收", "Fixes and final acceptance", "reference", ["post_master_package"]),
  subtitle_package: guide("输出与锁定画面同步的字幕文件。", "Outputs subtitles synchronized to locked picture.", "Online 与交付母版", "Online and delivery master", "reference", ["picture_lock", "dialogue_adr"]),
  delivery_master: guide("输出平台要求的最终视频和音频母版。", "Outputs final platform-compliant picture and audio masters.", "成片交付", "Final delivery", "reference", ["post_master_package", "subtitle_package", "qc_report"]),
  production_acceptance: guide("确认关键制作包、质量门和母版全部满足交付条件。", "Confirms required packages, gates, and masters are delivery-ready.", "制片控制台的最终放行", "Final production release", "automatic", ["delivery_master", "qc_report"]),
} satisfies Record<string, LocalizedDeliverableGuidance>;

function guide(
  purposeZh: string,
  purposeEn: string,
  usedByZh: string,
  usedByEn: string,
  mode: DeliverableUseMode,
  dependencyTypes: string[],
) {
  return {
    purpose: { "zh-CN": purposeZh, en: purposeEn },
    usedBy: { "zh-CN": usedByZh, en: usedByEn },
    mode,
    dependencyTypes,
  } as const;
}

export function getDeliverableGuidance(
  locale: StudioLocale,
  type: string,
): DeliverableGuidance {
  const value = (
    guidance as Record<string, LocalizedDeliverableGuidance | undefined>
  )[type];
  return value
    ? {
        purpose: value.purpose[locale],
        usedBy: value.usedBy[locale],
        mode: value.mode,
        dependencyTypes: [...value.dependencyTypes],
      }
    : {
        purpose:
          locale === "en"
            ? "Defines the executable decisions and acceptance boundary for this production step."
            : "明确当前制作步骤的执行决策和验收边界。",
        usedBy:
          locale === "en" ? "The next approved production step" : "下一项已批准的制作步骤",
        mode: "reference",
        dependencyTypes: [],
      };
}

export function suggestedDependencyIds(
  type: string,
  deliverables: ProductionDeliverableRecord[],
) {
  const expected = new Set(
    getDeliverableGuidance("zh-CN", type).dependencyTypes,
  );
  const current = deliverables
    .filter(
      (item) =>
        expected.has(item.deliverableType) &&
        ["approved", "locked"].includes(item.status),
    )
    .sort((left, right) => right.version - left.version);
  const selected = new Map<string, string>();
  for (const item of current)
    if (!selected.has(item.deliverableType))
      selected.set(item.deliverableType, item.id);
  return [...selected.values()];
}

export function filterProductionDeliverables(
  deliverables: ProductionDeliverableRecord[],
  departments: string[],
  types?: string[],
) {
  const departmentSet = new Set(departments);
  const typeSet = types ? new Set(types) : null;
  return deliverables.filter(
    (deliverable) =>
      departmentSet.has(deliverable.department) &&
      (!typeSet || typeSet.has(deliverable.deliverableType)),
  );
}

export function getDeliverableBlockers(
  deliverable: ProductionDeliverableRecord,
) {
  return deliverable.dependencies.filter(
    (dependency) =>
      !["approved", "locked"].includes(dependency.status) ||
      dependency.requiredVersion !== dependency.currentVersion,
  );
}

export function getNextPendingGate(
  deliverable: ProductionDeliverableRecord,
) {
  return deliverable.approvalGates.find((gate) => gate.status === "pending");
}

export function payloadLines(value: unknown) {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string")
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  return [];
}
