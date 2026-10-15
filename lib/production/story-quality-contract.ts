import { z } from "zod";
import type { StructuredValidationIssue } from "@/lib/llm/structured-output";

/** User-authored limits, frozen with a production request. Unspecified limits stay unspecified. */
export const StoryProductionConstraintsSchema = z.object({
  sceneCount: z.number().int().min(1).max(100).optional(),
  characterCount: z.number().int().min(1).max(100).optional(),
  locationCount: z.number().int().min(1).max(100).optional(),
  targetDurationSeconds: z.number().int().min(1).max(3600).optional(),
  propPolicy: z.enum(["standard", "minimal", "inline"]).optional(),
});
export type StoryProductionConstraints = z.infer<
  typeof StoryProductionConstraintsSchema
>;

const countText = "(\\d{1,4}|[零一二三四五六七八九十百两]+)";
function count(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  let result = 0,
    digit = 0;
  for (const character of value) {
    if (character === "十" || character === "百") {
      result += (digit || 1) * (character === "十" ? 10 : 100);
      digit = 0;
    } else digit = digits[character] ?? 0;
  }
  return result + digit;
}

function isExactRequest(text: string, start: number, end: number) {
  const prefix =
    text
      .slice(0, start)
      .split(/[。！？!?；;\n，,]/u)
      .at(-1) ?? "";
  // A later correction starts a new instruction within the same sentence.
  const currentPrefix =
    prefix.split(/而是|改为|但是|但|\b(?:instead|but)\b/iu).at(-1) ?? "";
  const suffix = text.slice(end);
  return (
    !/不|非|至少|最多|不少于|大概|大约|预计|估计|预估|约|近似|\b(?:not|never|no|at\s+least|at\s+most|up\s+to|approximately|about|around|roughly|estimated?)\b/iu.test(
      currentPrefix,
    ) &&
    !/^\s*(?:左右|上下|前后|以内|以上|以下|起|多|到|至|[~～+]|\bor\s+so\b|\bapproximately\b)/iu.test(
      suffix,
    )
  );
}

function inferPropPolicy(
  text: string,
): StoryProductionConstraints["propPolicy"] {
  let policy: StoryProductionConstraints["propPolicy"];
  for (const clause of text.split(/[。！？!?；;\n，,]/u)) {
    const noIndependent =
      /不(?:要|必|用|需要)?(?:为|给)?[^。\n]{0,24}道具[^。\n]{0,12}(?:独立|单独)(?:建档|管理|生图)/u.test(
        clause,
      );
    const allInline =
      /(?:所有|全部)(?:的)?道具[^。\n]{0,8}(?:作为|留作)普通场景道具|(?:^|[:：])\s*(?:请将|请把|改为|本次)?\s*道具(?:全部|均|都|一律)?(?:只|仅)?作为普通场景道具|\bprops?\s+inline\b/iu.test(
        clause,
      );
    const unqualifiedBan =
      /(?:^|[:：])\s*(?:请)?不(?:要|必|用|需要)?(?:为|给)?(?:所有|全部|任何)?道具(?:独立|单独)(?:建档|管理|生图)/u.test(
        clause,
      );
    // Not every prop needs a dossier is a selective policy, not a ban on all dossiers.
    const notEveryProp = /不(?:必|用|需要)(?:为|给)?(?:所有|全部)道具/u.test(
      clause,
    );
    if (
      (allInline && !/不|\bnot\b/iu.test(clause)) ||
      (unqualifiedBan && !notEveryProp)
    )
      policy = "inline";
    else if (noIndependent || /作为普通场景道具/u.test(clause))
      policy = "minimal";
    if (
      /道具[^。\n]{0,20}(?:尽量少|精简|只保留关键)|尽量少[^。\n]{0,12}(?:独立)?道具|只保留关键[^。\n]{0,12}(?:独立|单独)|\bminimal\s+props?\b/iu.test(
        clause,
      )
    )
      policy = "minimal";
    // Explicit exceptions after a blanket instruction keep independently managed objects possible.
    if (
      policy === "inline" &&
      /(?:独立|单独)(?:建档|管理|生图)/u.test(clause) &&
      !/不|禁止|角色|人物|场景|地点|镜头|分镜/u.test(clause)
    )
      policy = "minimal";
  }
  return policy;
}

/** Only unambiguous exact limits are inferred. Approximate/upper-bound statements remain prose. */
export function resolveStoryProductionConstraints(
  text: string,
  explicit?: StoryProductionConstraints,
) {
  const result: StoryProductionConstraints = {};
  const exact =
    "(?:仅(?:设|有|含|用|限)?|只(?:设|有|含|用)?|恰好|总共|全(?:片|剧)(?:仅|共|限|只有)?|共)\\s*";
  const patterns: Array<[keyof StoryProductionConstraints, RegExp]> = [
    [
      "sceneCount",
      new RegExp(
        `${exact}${countText}\\s*(?:个)?(?:连续)?场(?:次)?(?!景)`,
        "gu",
      ),
    ],
    [
      "characterCount",
      new RegExp(
        `${exact}${countText}\\s*(?:个|名|位)?(?:成年)?(?:角色|人物|人)`,
        "gu",
      ),
    ],
    [
      "locationCount",
      new RegExp(
        `${exact}${countText}\\s*(?:个|处)?(?:发生)?(?:地点|场景)`,
        "gu",
      ),
    ],
    [
      "characterCount",
      new RegExp(
        `${countText}\\s*(?:个|名|位)(?:成年)?(?:角色|人物)\\s*[:：]`,
        "gu",
      ),
    ],
    ["sceneCount", /\bexactly\s+(\d{1,3})\s+scenes?\b/giu],
    [
      "characterCount",
      /\b(?:exactly|only)\s+(\d{1,3})\s+(?:adult\s+)?(?:characters?|people)\b/giu,
    ],
    ["locationCount", /\b(?:exactly|only)\s+(\d{1,3})\s+locations?\b/giu],
    [
      "targetDurationSeconds",
      new RegExp(
        `(?:总时长|全片时长|片长|时长)\\s*(?:为|是|[:：])?\\s*${countText}\\s*秒`,
        "gu",
      ),
    ],
    [
      "targetDurationSeconds",
      /\b(?:runtime|duration)\s*(?:of|is|:)?\s*(\d{1,4})\s*(?:seconds?|s)\b/giu,
    ],
    ["locationCount", /全(?:剧|片)只在同一(?:间|个|处)/gu],
  ];
  const found = new Map<string, { index: number; value: number }>();
  for (const [key, pattern] of patterns)
    for (const match of text.matchAll(pattern)) {
      if (!isExactRequest(text, match.index, match.index + match[0].length))
        continue;
      const value = match[1] ? count(match[1]) : 1;
      if (
        value > 0 &&
        value <= (key === "targetDurationSeconds" ? 3600 : 100) &&
        (found.get(key)?.index ?? -1) < match.index
      )
        found.set(key, { index: match.index, value });
    }
  for (const [key, entry] of found)
    Object.assign(result, { [key]: entry.value });
  const propPolicy = inferPropPolicy(text);
  if (propPolicy) result.propPolicy = propPolicy;
  return StoryProductionConstraintsSchema.parse({ ...result, ...explicit });
}

type StoryCounts = {
  characters: readonly { name: string }[];
  locations: readonly { name: string }[];
  props: readonly { name: string }[];
  firstEpisode?: { scenes: readonly { durationSeconds: number }[] };
};
export function validateStoryProductionConstraints(
  story: StoryCounts,
  constraints: StoryProductionConstraints,
): StructuredValidationIssue[] {
  const issues: StructuredValidationIssue[] = [];
  for (const [key, actual, path] of [
    ["characterCount", story.characters.length, "characters"],
    ["locationCount", story.locations.length, "locations"],
    ["sceneCount", story.firstEpisode?.scenes.length, "firstEpisode.scenes"],
  ] as const)
    if (
      constraints[key] !== undefined &&
      actual !== undefined &&
      actual !== constraints[key]
    )
      issues.push({
        code: "story_constraint_mismatch",
        path,
        message: `${key}: expected ${constraints[key]}, received ${actual}. Scenes and shots are separate; do not relabel shots as scenes.`,
      });
  if (constraints.propPolicy === "inline" && story.props.length)
    issues.push({
      code: "story_prop_scope_mismatch",
      path: "props",
      message:
        "Ordinary props stay in scene descriptions; no independent prop dossiers were authorized.",
    });
  if (constraints.targetDurationSeconds && story.firstEpisode) {
    const seconds = story.firstEpisode.scenes.reduce(
      (sum, scene) => sum + scene.durationSeconds,
      0,
    );
    if (Math.abs(seconds - constraints.targetDurationSeconds) > 1)
      issues.push({
        code: "story_duration_constraint_mismatch",
        path: "firstEpisode.scenes",
        message: `Expected ${constraints.targetDurationSeconds}s, received ${seconds}s.`,
      });
  }
  return issues;
}

export function canonicalSceneDialogue(scene: {
  sceneNumber: number;
  dialogue: readonly { speaker: string; line: string }[];
}) {
  return scene.dialogue.map((line, index) => ({
    id: `scene-${scene.sceneNumber}-line-${index + 1}`,
    order: index,
    speaker: line.speaker,
    content: line.line,
  }));
}

const speechDelivery =
  /(?:轻声|低声|高声|大声|小声|缓缓|平静地|平静|轻轻|接着|继续|随后|然后|又|再|并|softly|quietly|calmly|then|again|and)\s*$/iu;
function trimSpeechDelivery(value: string) {
  let result = value.trim(),
    previous: string;
  do {
    previous = result;
    result = result.replace(speechDelivery, "").trim();
  } while (result !== previous);
  return result;
}

/** Read an explicit speech label/subject, never a bystander's name elsewhere in the prose. */
function dialogueSpeaker(prefix: string, speakers: readonly string[]) {
  let attribution = prefix
    .trim()
    .replace(/[“‘"']+\s*$/u, "")
    .trim();
  const bracketLabel = attribution.match(/[【\[]([^】\]]+)[】\]]\s*$/u);
  if (bracketLabel) return bracketLabel[1].trim();
  const hasColon = /[:：]$/u.test(attribution);
  attribution = attribution.replace(/[:：]\s*$/u, "").trim();
  // Parenthetical performance notes can be arbitrarily long without hiding the speaker.
  attribution = attribution.replace(/（[^（）]*）|\([^()]*\)/gu, " ").trim();
  const speechVerb =
    /(?:说(?:道|着)?|问(?:道)?|回答(?:道)?|答(?:道)?|低语|喊(?:道)?|开口|道|\b(?:says?|asks?|replies|replied|answers?|answered|whispers?|said))\s*$/iu;
  const hasSpeechVerb = speechVerb.test(attribution);
  if (!hasColon && !hasSpeechVerb) {
    const bareLabel = attribution
      .split(/[。.!?！？;；\n，,”’"']/u)
      .at(-1)
      ?.trim();
    return speakers.find((speaker) => speaker === bareLabel);
  }
  attribution = trimSpeechDelivery(attribution.replace(speechVerb, ""));
  const clauses = attribution
    .split(/[。.!?！？;；:：\n，,”’"']/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (!clauses.length) return undefined;
  for (let index = clauses.length - 1; index >= 0; index--) {
    const clause = trimSpeechDelivery(clauses[index])
      .replace(/^(?:[-*•]\s*|(?:随后|然后|接着|此时|画面中|镜头中)\s*)/u, "")
      .trim();
    if (!clause) continue;
    const knownSpeaker = speakers.find((speaker) => clause.startsWith(speaker));
    if (knownSpeaker) return knownSpeaker;
    // A direct unknown speaker must override an earlier known spectator or inherited speaker.
    // Recipient clauses (A 对 B 说) keep A as the subject.
    if (index === clauses.length - 1) {
      const subject = clause.split(/(?:对|向)(?=\S)/u)[0].trim();
      if (/^(?:\p{Script=Han}{1,4}|[A-Za-z][A-Za-z .'-]{0,40})$/u.test(subject))
        return subject;
    }
  }
  return null;
}

/** Prompt prose is reviewed against the frozen ledger, rather than becoming another speech source. */
export function validateSceneDialoguePrompt(
  prompt: string,
  lines: readonly { speaker: string; content: string }[],
): StructuredValidationIssue[] {
  const issues: StructuredValidationIssue[] = [];
  let cursor = 0;
  let previousSpeaker: string | undefined;
  const speakers = [...new Set(lines.map((line) => line.speaker))].sort(
    (a, b) => b.length - a.length,
  );
  for (const [index, line] of lines.entries()) {
    const found = prompt.indexOf(line.content, cursor);
    if (found < 0) {
      issues.push({
        code: "dialogue_prompt_missing_or_reordered",
        path: `dialogue.${index}`,
        message: `Preserve line ${index + 1}, in order, spoken by ${line.speaker}: ${line.content}`,
      });
      continue;
    }
    const explicitSpeaker = dialogueSpeaker(
      prompt.slice(cursor, found),
      speakers,
    );
    const speaker =
      explicitSpeaker === undefined ? previousSpeaker : explicitSpeaker;
    if (speaker !== line.speaker)
      issues.push({
        code: "dialogue_prompt_speaker_missing",
        path: `dialogue.${index}.speaker`,
        message: `Attribute this line explicitly to ${line.speaker}.`,
      });
    previousSpeaker = speaker ?? undefined;
    cursor = found + line.content.length;
  }
  return issues;
}

/** Multiple-timepoint image prose cannot define a single usable video starting frame. */
export function validateSingleFramePrompt(
  prompt: string,
): StructuredValidationIssue[] {
  return /随后|然后|接着|紧接着|\b(?:then|afterwards)\b/iu.test(prompt)
    ? [
        {
          code: "image_prompt_multiple_moments",
          path: "imagePrompt",
          message:
            "Describe the frozen start state only. Move subsequent actions and state changes into motionBeats/videoPrompt.",
        },
      ]
    : [];
}
