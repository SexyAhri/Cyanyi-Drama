import type { ScreenplayConversion } from "@/lib/prompts/schemas";

type ScreenplayContent = ScreenplayConversion["scenes"][number]["content"][number];

/**
 * Promotes explicit speech and clearly attributed inner monologue while leaving
 * ordinary narration and free indirect discourse as action.
 */
export function normalizeScreenplayDialogue(
  screenplay: ScreenplayConversion,
): ScreenplayConversion {
  return {
    ...screenplay,
    scenes: screenplay.scenes.map((scene) => ({
      ...scene,
      content: scene.content.flatMap((content) =>
        content.type === "action"
          ? splitQuotedDialogue(content.text, scene.characters).flatMap(
              (quoted) =>
                quoted.type === "action"
                  ? splitInnerMonologue(quoted.text, scene.characters).flatMap(
                      (segment) =>
                        segment.type === "action"
                          ? splitAttributedSpeech(segment.text, scene.characters)
                          : [segment],
                    )
                  : [quoted],
            )
          : [content],
      ),
    })),
  };
}

function splitQuotedDialogue(
  text: string,
  characters: readonly string[],
): ScreenplayContent[] {
  const pattern = /[“"]([^”"\r\n]+)[”"]([^。！？!?]{0,28})/g;
  const result: ScreenplayContent[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const leading = text.slice(cursor, index).trim();
    const speaker = lastMentionedCharacter(
      `${leading}${match[2]}`,
      characters,
    );
    if (!speaker) continue;
    if (leading) result.push({ type: "action", text: leading });
    result.push({
      type: "dialogue",
      character: speaker,
      parenthetical: null,
      lines: match[1].trim(),
    });
    const suffix = match[2].trim();
    if (suffix) result.push({ type: "action", text: suffix });
    cursor = index + match[0].length;
  }
  const trailing = text.slice(cursor).trim();
  if (trailing) result.push({ type: "action", text: trailing });
  return result.length ? result : [{ type: "action" as const, text }];
}

function splitInnerMonologue(
  text: string,
  characters: readonly string[],
): ScreenplayContent[] {
  const pattern = /(?:若|如果)(?:自己|我)[^。！？!?]+[。！？!?]?/g;
  const result: ScreenplayContent[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const before = text.slice(cursor, index);
    const speaker = lastMentionedCharacter(before, characters);
    if (!speaker) continue;
    if (before.trim()) result.push({ type: "action", text: before.trim() });
    result.push({
      type: "voiceover",
      character: speaker,
      text: match[0].trim(),
    });
    cursor = index + match[0].length;
  }
  const trailing = text.slice(cursor).trim();
  if (trailing) result.push({ type: "action", text: trailing });
  return result.length ? result : [{ type: "action" as const, text }];
}

function lastMentionedCharacter(text: string, characters: readonly string[]) {
  return characters
    .map((name) => ({ name, index: text.lastIndexOf(name) }))
    .filter((item) => item.index >= 0)
    .sort((left, right) => right.index - left.index)[0]?.name;
}

function splitAttributedSpeech(
  text: string,
  characters: readonly string[],
): ScreenplayContent[] {
  const candidates = [...characters]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegex);
  if (!candidates.length) return [{ type: "action" as const, text }];

  const speechVerb =
    "说(?:道)?|问(?:道)?|答(?:道)?|回答|回应|喊(?:道)?|叫(?:道)?|喝(?:道)?|叹(?:道)?|笑(?:道)?|开口|低声(?:说)?|轻声(?:说)?|安慰|劝(?:说|慰)?|安抚|鼓励";
  const pattern = new RegExp(
    `(${candidates.join("|")})([^。！？!?“”\\"]{0,24}?)(${speechVerb})([^。！？!?“”\\"]{0,24}?)[：:，,]\\s*([^。！？!?]+[。！？!?]?)`,
    "g",
  );
  const result: ScreenplayContent[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const leading = text.slice(cursor, index).trim();
    const attribution = `${match[1]}${match[2]}${match[3]}${match[4]}`.trim();
    const line = match[5].trim();
    if (leading) result.push({ type: "action", text: leading });
    if (attribution) result.push({ type: "action", text: attribution });
    if (line)
      result.push({
        type: "dialogue",
        character: characters.find((name) => name === match[1]) ?? match[1],
        parenthetical: null,
        lines: line,
      });
    cursor = index + match[0].length;
  }
  const trailing = text.slice(cursor).trim();
  if (trailing) result.push({ type: "action", text: trailing });
  return result.length ? result : [{ type: "action" as const, text }];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
