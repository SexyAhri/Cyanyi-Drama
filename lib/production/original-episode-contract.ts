import { StoryPackageFirstEpisodeSchema, type StoryPackage } from "./story-package-contract";

/** Normalize presentation differences without inventing new story assets. */
export function normalizeOriginalEpisodeOutput(value: unknown, story: StoryPackage, locale: "zh" | "en") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  const parsed = StoryPackageFirstEpisodeSchema.shape.firstEpisode.safeParse(raw.episode);
  if (!parsed.success) return value;
  const key = (name: string) => name.normalize("NFKC").trim().replace(/[\s「」『』“”"']/gu, "").toLocaleLowerCase();
  const base = (name: string) => key(name).replace(/\([^()]*\)/gu, "");
  const names = {
    character: story.characters.map((item) => item.name),
    location: story.locations.map((item) => item.name),
    prop: story.props.map((item) => item.name),
  };
  function canonical(kind: keyof typeof names, name: string) {
    const exact = names[kind].find((candidate) => key(candidate) === key(name));
    if (exact) return exact;
    // A shortened name is safe only when it equals one unique canonical base name.
    const candidates = names[kind].filter((candidate) => base(candidate) === key(name));
    return candidates.length === 1 ? candidates[0] : name;
  }
  const labels = locale === "zh"
    ? { character: "角色参考", location: "场景参考", prop: "道具参考" }
    : { character: "character reference", location: "location reference", prop: "prop reference" };
  const episode = parsed.data;
  episode.scenes = episode.scenes.map((scene) => {
    const slots = scene.imageReferenceSlots.map((slot) => ({ ...slot, name: canonical(slot.kind, slot.name) }));
    const missing = slots.filter((slot) => {
      if (!names[slot.kind].includes(slot.name)) return false;
      const marker = locale === "zh"
        ? new RegExp(`图片\\s*${slot.number}\\s*[（(]`)
        : new RegExp(`Image\\s*${slot.number}\\s*\\(`, "i");
      return !marker.test(scene.videoPrompt);
    });
    const bindings = missing.map((slot) => locale === "zh"
      ? `图片 ${slot.number}（${labels[slot.kind]}：${slot.name}）`
      : `Image ${slot.number} (${labels[slot.kind]}: ${slot.name})`);
    return {
      ...scene,
      characters: scene.characters.map((name) => canonical("character", name)),
      location: canonical("location", scene.location),
      props: scene.props.map((name) => canonical("prop", name)),
      dialogue: scene.dialogue.map((line) => ({ ...line, speaker: canonical("character", line.speaker) })),
      imageReferenceSlots: slots,
      videoPrompt: bindings.length
        ? `${locale === "zh" ? "参考图槽位（待绑定）" : "Reference slots (awaiting binding)"}: ${bindings.join("; ")}\n${scene.videoPrompt}`
        : scene.videoPrompt,
    };
  });
  return { ...raw, episode };
}
