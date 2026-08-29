import { loadApprovedWorldBible } from "@/lib/production/world-bible";
import { prisma } from "@/lib/server/prisma";

import type {
  AssetStoryWorldLock,
  AssetVisualProfileSpec,
} from "./visual-profile";

export type AssetStoryWorldContext = {
  projectName: string | null;
  projectDescription: string | null;
  projectVisualContext: string | null;
  visualEra: "source" | "premodern" | "contemporary" | "custom";
  visualEraCustom: string | null;
  manuscripts: Array<{ title: string; synopsis: string | null }>;
  approvedWorldBible: unknown;
  relatedSourceEvidence: string[];
  lock: AssetStoryWorldLock;
  groundingText: string;
};

type StoryWorldSetting = AssetStoryWorldLock["setting"];

const CULTIVATION_MARKERS = [
  "修仙",
  "修炼",
  "修者",
  "淬体",
  "炼体",
  "真气",
  "精元",
  "灵气",
  "灵药",
  "功法",
  "境界",
  "宗门",
  "妖兽",
  "阴阳之境",
];

const PREMODERN_MARKERS = [
  "王朝",
  "郡",
  "府邸",
  "庄院",
  "山庄",
  "回廊",
  "灯笼",
  "竹榻",
  "古籍",
  "族比",
  "家主",
  "门楣",
];

const CONTEMPORARY_MARKERS = [
  "现代都市",
  "办公室",
  "写字楼",
  "公司职员",
  "智能手机",
  "地铁站",
  "汽车",
  "互联网",
];

const PREMODERN_CONFLICTS = [
  {
    label: "现代商务服装",
    pattern:
      /西装|西服|衬衫|领带|领结|西裤|商务外套|呢质外套|blazer|business\s+suit|dress\s+shirt|necktie/giu,
  },
  {
    label: "现代休闲服装",
    pattern: /T恤|T-shirt|卫衣|牛仔裤|运动鞋|球鞋|高跟鞋|hoodie|sneakers/giu,
  },
  {
    label: "现代短发造型",
    pattern: /短直发|短发发型|寸头|undercut|crew\s+cut/giu,
  },
  {
    label: "现代建筑或室内",
    pattern: /现代室内|现代公寓|办公室|写字楼|会议室|玻璃幕墙|商业街/giu,
  },
  {
    label: "现代科技或交通工具",
    pattern: /智能手机|手机|电脑|汽车|摩托车|电梯|显示器|笔记本电脑/giu,
  },
] as const;

export async function loadProjectAssetStoryWorldContext(input: {
  userId: string;
  projectId: string;
  assetName: string;
  assetFacts?: unknown;
}): Promise<AssetStoryWorldContext> {
  const [project, approvedWorldBible] = await Promise.all([
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        name: true,
        description: true,
        config: {
          select: {
            globalAssetText: true,
            visualEra: true,
            visualEraCustom: true,
          },
        },
        manuscripts: {
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { title: true, synopsis: true },
        },
      },
    }),
    loadApprovedWorldBible(input.userId, input.projectId),
  ]);

  let episodes = await loadRelatedEpisodes(input.projectId, input.assetName);
  if (!episodes.length) episodes = await loadRelatedEpisodes(input.projectId);

  return buildAssetStoryWorldContext({
    projectName: project?.name ?? null,
    projectDescription: project?.description ?? null,
    projectVisualContext: project?.config?.globalAssetText ?? null,
    visualEra: normalizeVisualEra(project?.config?.visualEra),
    visualEraCustom: project?.config?.visualEraCustom ?? null,
    manuscripts: project?.manuscripts ?? [],
    approvedWorldBible: approvedWorldBible?.payload ?? null,
    assetFacts: input.assetFacts,
    relatedSourceEvidence: episodes.flatMap((episode) => {
      const sources = [
        episode.description,
        episode.novelText,
        ...episode.sourceVersions.flatMap((source) => [
          source.summary,
          source.content,
        ]),
      ];
      return sources.flatMap((source) =>
        source ? evidenceWindows(source, input.assetName) : [],
      );
    }),
  });
}

export function buildAssetStoryWorldContext(input: {
  projectName?: string | null;
  projectDescription?: string | null;
  projectVisualContext?: string | null;
  visualEra?: "source" | "premodern" | "contemporary" | "custom";
  visualEraCustom?: string | null;
  manuscripts?: Array<{ title: string; synopsis: string | null }>;
  approvedWorldBible?: unknown;
  assetFacts?: unknown;
  relatedSourceEvidence?: string[];
}): AssetStoryWorldContext {
  const manuscripts = input.manuscripts ?? [];
  const relatedSourceEvidence = uniqueStrings(
    input.relatedSourceEvidence ?? [],
  ).slice(0, 6);
  const groundingText = [
    input.projectName,
    input.projectDescription,
    input.projectVisualContext,
    ...manuscripts.flatMap((item) => [item.title, item.synopsis]),
    serializeCompact(input.approvedWorldBible),
    serializeCompact(input.assetFacts),
    ...relatedSourceEvidence,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
  const visualEra = input.visualEra ?? "source";
  const visualEraCustom = input.visualEraCustom?.trim() || null;
  const detectedLock = detectStoryWorldLock(groundingText);
  const lock = applyVisualEraOverride(
    detectedLock,
    visualEra,
    visualEraCustom,
  );
  return {
    projectName: input.projectName ?? null,
    projectDescription: input.projectDescription ?? null,
    projectVisualContext: input.projectVisualContext ?? null,
    visualEra,
    visualEraCustom,
    manuscripts,
    approvedWorldBible: compactJsonValue(input.approvedWorldBible),
    relatedSourceEvidence,
    lock,
    groundingText,
  };
}

export function storyWorldContextForPrompt(context: AssetStoryWorldContext) {
  return {
    projectName: context.projectName,
    projectDescription: context.projectDescription,
    projectVisualContext: context.projectVisualContext,
    visualEra: context.visualEra,
    visualEraCustom: context.visualEraCustom,
    manuscripts: context.manuscripts,
    approvedWorldBible: context.approvedWorldBible,
    relatedSourceEvidence: context.relatedSourceEvidence,
    detectedWorld: context.lock,
  };
}

export function getStoryWorldDirective(
  lock: AssetStoryWorldLock,
  locale: "zh" | "en",
) {
  if (locale === "en") return englishStoryWorldDirective(lock);
  return chineseStoryWorldDirective(lock);
}

export function findVisualProfileStoryWorldConflicts(
  spec: AssetVisualProfileSpec,
  context: AssetStoryWorldContext,
) {
  return findStoryWorldTextConflicts(
    [
      spec.visualIdentity,
      spec.shapeAndStructure,
      spec.surfaceAndStyling,
      spec.lightingAndPresentation,
      ...spec.signatureDetails,
      ...spec.inferenceNotes,
    ].join("\n"),
    context,
  );
}

export function findStoryWorldTextConflicts(
  text: string,
  context: Pick<AssetStoryWorldContext, "lock" | "groundingText">,
) {
  if (
    context.lock.setting !== "premodern" &&
    context.lock.setting !== "premodern_cultivation"
  )
    return [];
  const conflicts = PREMODERN_CONFLICTS.filter(({ pattern }) =>
    hasUnsupportedAffirmativeMatch(text, pattern, context.groundingText),
  ).map(({ label }) => label);
  return [...new Set(conflicts)];
}

function detectStoryWorldLock(text: string): AssetStoryWorldLock {
  const cultivation = matchedMarkers(text, CULTIVATION_MARKERS);
  const premodern = matchedMarkers(text, PREMODERN_MARKERS);
  const contemporary = matchedMarkers(text, CONTEMPORARY_MARKERS);
  let setting: StoryWorldSetting = "unspecified";
  if (cultivation.length >= 2 && premodern.length >= 2)
    setting = "premodern_cultivation";
  else if (premodern.length >= 2) setting = "premodern";
  else if (contemporary.length >= 2) setting = "contemporary";
  return {
    setting,
    evidence: uniqueStrings([
      ...cultivation,
      ...premodern,
      ...contemporary,
    ]).slice(0, 12),
  };
}

function chineseStoryWorldDirective(lock: AssetStoryWorldLock) {
  const { setting } = lock;
  if (setting === "custom")
    return `项目自定义视觉世界（最高优先级）：${lock.customDirective ?? "尚未填写具体规则，请先补充自定义视觉世界规则"}。这是用户明确选择的改编世界，可覆盖原作时代的服装、发式、建筑、陈设、技术与交通形态，但不得改写人物身份、关系、能力、事件和剧情结果。`;
  if (setting === "premodern_cultivation")
    return "故事时代与世界观硬约束（独立于画风）：这是有明确文本依据的古代东方修炼世界。角色的服装、束发方式、鞋履和配饰，场景的建筑、陈设与材料，道具的结构和工艺都必须属于该世界；原文未指定的细节只能在此前提下推断。禁止西装、衬衫、领带、西裤、现代短发、商务皮鞋、现代室内、现代城市设施、现代科技和交通工具。画风只决定如何呈现，不能改变故事时代。";
  if (setting === "premodern")
    return "故事时代硬约束（独立于画风）：这是有明确文本依据的前现代世界。服装、发式、建筑、陈设、材料和道具工艺必须符合该时代；禁止无原文依据的现代商务服装、现代室内、现代科技和交通工具。画风只决定如何呈现，不能改变故事时代。";
  if (setting === "contemporary")
    return "故事时代硬约束（独立于画风）：这是有明确文本依据的当代世界。服装、建筑、陈设和道具应遵循输入中的当代语境，不得因画风名称擅自古装化或仙侠化。";
  return "故事时代尚未得到充分确认。画风只决定渲染语言，不等于故事时代；只能依据已提供的剧情事实推断服装、发式、建筑、陈设和道具，不得擅自现代化、古装化或仙侠化。";
}

function englishStoryWorldDirective(lock: AssetStoryWorldLock) {
  const { setting } = lock;
  if (setting === "custom")
    return `PROJECT CUSTOM VISUAL WORLD - HIGHEST PRIORITY: ${lock.customDirective ?? "No custom rule has been entered yet; complete the custom visual-world rule first"}. This user-selected adaptation world may override the source era for wardrobe, hair, architecture, furnishings, technology, and transport, but must not rewrite identities, relationships, abilities, events, or outcomes.`;
  if (setting === "premodern_cultivation")
    return "STORY WORLD AND ERA - HARD CONSTRAINT, SEPARATE FROM ART STYLE: The supplied text establishes a premodern Eastern cultivation world. Wardrobe, hair arrangement, footwear, accessories, architecture, furnishings, materials, and craft must belong to that world. Exclude business suits, dress shirts, ties, slacks, modern short hairstyles, business shoes, contemporary interiors, urban infrastructure, technology, and vehicles unless explicitly stated by the source. Art style controls rendering only; it cannot change the story era.";
  if (setting === "premodern")
    return "STORY ERA - HARD CONSTRAINT, SEPARATE FROM ART STYLE: The supplied text establishes a premodern world. Wardrobe, hair, architecture, furnishings, materials, and craft must fit that era. Exclude unsupported modern business clothing, interiors, technology, and vehicles. Art style controls rendering only; it cannot change the story era.";
  if (setting === "contemporary")
    return "STORY ERA - HARD CONSTRAINT, SEPARATE FROM ART STYLE: The supplied text establishes a contemporary world. Keep wardrobe, architecture, furnishings, and props grounded in that context; do not turn it into historical costume or cultivation fantasy because of the art-style label.";
  return "The story era is not sufficiently established. Art style controls rendering language and does not define the story era. Infer wardrobe, hair, architecture, furnishings, and props only from supplied facts; do not modernize, historicize, or turn the asset into cultivation fantasy without evidence.";
}

async function loadRelatedEpisodes(projectId: string, assetName?: string) {
  return prisma.episode.findMany({
    where: {
      projectId,
      ...(assetName
        ? {
            OR: [
              { name: { contains: assetName } },
              { description: { contains: assetName } },
              { novelText: { contains: assetName } },
            ],
          }
        : {}),
    },
    orderBy: { episodeNumber: "asc" },
    take: assetName ? 3 : 2,
    select: {
      description: true,
      novelText: true,
      sourceVersions: {
        orderBy: { createdAt: "desc" },
        take: 2,
        select: { summary: true, content: true },
      },
    },
  });
}

function evidenceWindows(text: string, needle: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const indexes: number[] = [];
  let from = 0;
  while (indexes.length < 2) {
    const index = normalized.indexOf(needle, from);
    if (index < 0) break;
    indexes.push(index);
    from = index + needle.length;
  }
  if (!indexes.length) return [normalized.slice(0, 700)];
  return indexes.map((index) => {
    const start = Math.max(0, index - 300);
    const end = Math.min(normalized.length, index + needle.length + 400);
    return normalized.slice(start, end);
  });
}

function matchedMarkers(text: string, markers: readonly string[]) {
  return markers.filter((marker) => text.includes(marker));
}

function applyVisualEraOverride(
  detected: AssetStoryWorldLock,
  mode: "source" | "premodern" | "contemporary" | "custom",
  customDirective: string | null,
): AssetStoryWorldLock {
  if (mode === "source") return { ...detected, mode };
  if (mode === "contemporary")
    return { mode, setting: "contemporary", evidence: ["项目设置：现代都市改编"] };
  if (mode === "premodern")
    return {
      mode,
      setting:
        detected.setting === "premodern_cultivation"
          ? "premodern_cultivation"
          : "premodern",
      evidence: ["项目设置：古代东方", ...detected.evidence].slice(0, 12),
    };
  if (!customDirective) return { ...detected, mode: "source" };
  return {
    mode,
    setting: "custom",
    evidence: ["项目设置：自定义世界"],
    customDirective,
  };
}

function normalizeVisualEra(value: string | null | undefined) {
  return value === "premodern" ||
    value === "contemporary" ||
    value === "custom"
    ? value
    : "source";
}

function hasUnsupportedAffirmativeMatch(
  text: string,
  pattern: RegExp,
  groundingText: string,
) {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    if (groundingText.toLocaleLowerCase().includes(value.toLocaleLowerCase()))
      continue;
    const before = text.slice(Math.max(0, index - 18), index);
    const lineBefore = text.slice(text.lastIndexOf("\n", index - 1) + 1, index);
    if (
      /^\s*(?:排除项|负面提示|negative\s+prompt)\s*[:：]/iu.test(
        lineBefore,
      ) ||
      /(?:避免|禁止|不得|不要|排除|不采用|无|no|not|without|avoid|exclude)[^，。；;\n]{0,12}$/iu.test(
        before,
      )
    )
      continue;
    return true;
  }
  return false;
}

function compactJsonValue(value: unknown) {
  const serialized = serializeCompact(value);
  if (!serialized) return null;
  return serialized.length <= 8_000
    ? value
    : `${serialized.slice(0, 8_000)}...[truncated]`;
}

function serializeCompact(value: unknown) {
  try {
    return value == null ? "" : JSON.stringify(value);
  } catch {
    return "";
  }
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
