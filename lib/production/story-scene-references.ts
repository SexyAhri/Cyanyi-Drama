import type { StructuredValidationIssue } from "@/lib/llm/structured-output";
import type { StoryPackage } from "./story-package-contract";

type Scene = Pick<StoryPackage["firstEpisode"]["scenes"][number], "characters" | "props" | "location">;
type Slots = StoryPackage["firstEpisode"]["scenes"][number]["imageReferenceSlots"];
type Kind = Slots[number]["kind"];

/** References are mechanical metadata derived from the validated draft, not creative model output. */
export function buildSceneReferenceSlots(scene: Scene): Slots {
  const entries: Array<{ kind: Kind; name: string }> = [
    ...scene.characters.map(name => ({ kind: "character" as const, name })),
    ...scene.props.map(name => ({ kind: "prop" as const, name })),
    { kind: "location", name: scene.location },
  ];
  const seen = new Set<string>();
  return entries.filter(entry => {
    const key = `${entry.kind}:${entry.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((entry, index) => ({ number: index + 1, ...entry }));
}

function nameKey(name: string) {
  return name.normalize("NFKC").trim().replace(/[\s「」『』“”‘’"']/gu, "").toLowerCase();
}

// Only normalize spelling/presentation of an exact name. Never guess semantic aliases.
export function canonicalStoryAssetName(name: string, names: string[]) {
  if (names.includes(name)) return name;
  const matches = names.filter(candidate => nameKey(candidate) === nameKey(name));
  return matches.length === 1 ? matches[0] : name;
}

function marker(slot: Slots[number], locale: "zh" | "en") {
  const labels = locale === "zh"
    ? { character: "角色参考", prop: "道具参考", location: "场景参考" }
    : { character: "character reference", prop: "prop reference", location: "location reference" };
  return locale === "zh"
    ? `图片 ${slot.number}（${labels[slot.kind]}：${slot.name}）`
    : `Image ${slot.number} (${labels[slot.kind]}: ${slot.name})`;
}

const annotationPattern = /(?:图片|Image)\s*(\d+)\s*[（(]\s*(角色|人物|场景|地点|道具|character|location|prop)(?:\s*(?:参考|reference))?\s*[:：]\s*([^()（）\n]+)[)）]/giu;
const kinds: Record<string, Kind> = {
  角色: "character", 人物: "character", 场景: "location", 地点: "location", 道具: "prop",
  character: "character", location: "location", prop: "prop",
};

/** Add bindings without changing dramatic content; only unambiguous named marker renumbering is safe. */
export function compileSceneDesignReferences(value: unknown, slots: Slots, locale: "zh" | "en") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  if (typeof raw.videoPrompt !== "string" || raw.videoPrompt.trim().length < 100) return value;
  const videoPrompt = raw.videoPrompt.replace(annotationPattern, (original, _number: string, kind: string, name: string) => {
    const matches = slots.filter(slot => slot.kind === kinds[kind.toLowerCase()] && nameKey(slot.name) === nameKey(name));
    return matches.length === 1 ? marker(matches[0], locale) : original;
  });
  const bindings = slots.map(slot => marker(slot, locale)).join("; ");
  const header = `${locale === "zh" ? "参考图槽位（待绑定）" : "Reference slots (awaiting binding)"}: ${bindings}`;
  return { ...raw, videoPrompt: videoPrompt.startsWith(`${header}\n`) ? videoPrompt : `${header}\n${videoPrompt}` };
}

/** Do not let a generated header hide unknown/mistyped references elsewhere in the prompt. */
export function validateSceneReferenceAnnotations(videoPrompt: string, slots: Slots): StructuredValidationIssue[] {
  const issues: StructuredValidationIssue[] = [];
  for (const match of videoPrompt.matchAll(annotationPattern)) {
    const [, number, rawKind, name] = match;
    const kind = kinds[rawKind.toLowerCase()];
    if (!slots.some(slot => slot.number === Number(number) && slot.kind === kind && nameKey(slot.name) === nameKey(name))) {
      issues.push({ code: "video_reference_annotation_mismatch", path: "videoPrompt",
        message: `Reference ${match[0]} must match a supplied scene binding by number, kind and exact name.` });
    }
  }
  for (const match of videoPrompt.matchAll(/(?:图片|\bImage)\s*(\d+)/giu)) {
    if (!slots.some(slot => slot.number === Number(match[1]))) issues.push({
      code: "video_reference_number_unknown", path: "videoPrompt",
      message: `Reference number ${match[1]} is not in the supplied scene bindings.`,
    });
  }
  return issues;
}
