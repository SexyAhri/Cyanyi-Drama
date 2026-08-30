import type { ScreenplayConversion } from "@/lib/prompts/schemas";
import {
  isDirectSpeechExcerpt,
  isImplicitVisualBridgeAction,
} from "@/lib/prompts/validators";

type ScreenplayContent = ScreenplayConversion["scenes"][number]["content"][number];

/**
 * Promotes explicit speech and clearly attributed inner monologue while leaving
 * ordinary narration and free indirect discourse as action.
 */
export function normalizeScreenplayDialogue(
  screenplay: ScreenplayConversion,
): ScreenplayConversion {
  const generatedNarration = screenplay.scenes.flatMap((scene) =>
    scene.content.flatMap((content) =>
      content.type === "voiceover" &&
      content.character === null &&
      !isExplicitNarratorVoiceover(content.text, screenplay.originalText)
        ? [content.text]
        : [],
    ),
  );
  return {
    ...screenplay,
    coverage: screenplay.coverage?.map((item) => ({
      ...item,
      modes: Array.from(
        new Set(
          item.modes.map((mode) =>
            mode === "voiceover" &&
            generatedNarration.some((text) =>
              eventTextsReferToEachOther(text, item.evidence),
            )
              ? generatedNarration.some(
                  (text) =>
                    eventTextsReferToEachOther(text, item.evidence) &&
                    isAttributedSpeechExcerpt(text, screenplay.originalText),
                )
                ? ("dialogue" as const)
                : ("visual" as const)
              : mode,
          ),
        ),
      ),
    })),
    scenes: screenplay.scenes.map((scene) => {
      let mostRecentActor: string | undefined;
      let mostRecentSpeaker: string | undefined;
      return {
        ...scene,
        content: scene.content.flatMap((content) => {
        const unspokenDialogue =
          content.type === "dialogue" &&
          !isDirectSpeechExcerpt(
            content.lines,
            content.character,
            screenplay.originalText,
          );
        if (content.type === "dialogue" && !unspokenDialogue)
          mostRecentSpeaker = content.character;
        const generatedNarratorVoiceover =
          content.type === "voiceover" &&
          content.character === null &&
          !isExplicitNarratorVoiceover(content.text, screenplay.originalText);
        const recoveredSpeaker =
          generatedNarratorVoiceover && content.type === "voiceover"
            ? inferAttributedSpeechSpeaker(
                content.text,
                screenplay.originalText,
                scene.characters,
                mostRecentSpeaker,
              )
            : undefined;
        const candidate = unspokenDialogue
          ? ({
              type: "action" as const,
              text: content.lines,
            } satisfies ScreenplayContent)
          : recoveredSpeaker && content.type === "voiceover"
            ? ({
                type: "dialogue" as const,
                character: recoveredSpeaker,
                parenthetical: null,
                lines: content.text,
              } satisfies ScreenplayContent)
            : generatedNarratorVoiceover && content.type === "voiceover"
              ? ({
                  type: "action" as const,
                  text: content.text,
                } satisfies ScreenplayContent)
              : content;
        if (candidate.type === "dialogue")
          mostRecentSpeaker = candidate.character;
        const resolvedContent =
          candidate.type === "action" &&
          candidate.origin === undefined &&
          isImplicitVisualBridgeAction(candidate.text, screenplay.originalText)
            ? {
                ...candidate,
                origin: "bridge" as const,
                evidence: [findBestSourceEvidence(candidate.text, screenplay.originalText)],
              }
            : candidate;
        if (
          resolvedContent.type !== "action" ||
          resolvedContent.origin === "bridge" ||
          resolvedContent.origin === "inferred"
        )
          return [resolvedContent];
        const explicitlyMentionedActor = firstMentionedCharacter(
          resolvedContent.text,
          scene.characters,
        );
        const actorHint = /^(?:若|如果)(?:自己|我)/.test(
          resolvedContent.text,
        )
          ? mostRecentActor
          : explicitlyMentionedActor ??
            mostRecentActor ??
            (unspokenDialogue && content.type === "dialogue"
              ? content.character
              : undefined);
        const normalized = splitQuotedDialogue(
          resolvedContent.text,
          scene.characters,
        )
          .flatMap((quoted) =>
            quoted.type === "action"
              ? splitInnerMonologue(
                  quoted.text,
                  scene.characters,
                  actorHint,
                ).flatMap(
                  (segment) =>
                    segment.type === "action"
                      ? splitAttributedSpeech(segment.text, scene.characters)
                      : [segment],
                )
              : [quoted],
          );
        const expanded = normalized.flatMap((segment) =>
          segment.type === "action"
            ? expandFilmableStateChanges(
                segment,
                scene.characters,
                actorHint,
                screenplay.originalText,
              )
            : [segment],
        );
        mostRecentActor = explicitlyMentionedActor ?? mostRecentActor;
        return expanded;
      }),
      };
    }),
  };
}

export function isExplicitNarratorVoiceover(
  content: string,
  sourceText: string,
) {
  const trimmed = content.trim();
  if (!trimmed) return false;
  let cursor = 0;
  while (cursor < sourceText.length) {
    const index = sourceText.indexOf(trimmed, cursor);
    if (index < 0) return false;
    const prefix = sourceText.slice(Math.max(0, index - 80), index);
    if (
      /(?:旁白|画外音|旁述|解说|narrator|voice[- ]?over|v\.?\s*o\.?)[^。！？!?\n]{0,24}[：:]\s*[“"]?\s*$/iu.test(
        prefix,
      )
    )
      return true;
    cursor = index + trimmed.length;
  }
  return false;
}

function eventTextsReferToEachOther(left: string, right: string) {
  const normalizedLeft = left.replace(/[\p{P}\p{S}\s]/gu, "");
  const normalizedRight = right.replace(/[\p{P}\p{S}\s]/gu, "");
  return (
    Boolean(normalizedLeft) &&
    Boolean(normalizedRight) &&
    (normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft))
  );
}

function inferAttributedSpeechSpeaker(
  content: string,
  sourceText: string,
  characters: readonly string[],
  mostRecentSpeaker?: string,
) {
  const prefix = attributedSpeechPrefix(content, sourceText);
  if (!prefix) return undefined;
  const named = lastMentionedCharacter(prefix, characters);
  if (named) return named;
  if (
    /(?:父亲|母亲|师父|老师|长老|族长|哥哥|姐姐|弟弟|妹妹|father|mother|teacher)/iu.test(
      prefix,
    )
  )
    return mostRecentSpeaker ??
      (characters.length === 1 ? characters[0] : undefined);
  return undefined;
}

function isAttributedSpeechExcerpt(content: string, sourceText: string) {
  return Boolean(attributedSpeechPrefix(content, sourceText));
}

function attributedSpeechPrefix(content: string, sourceText: string) {
  const trimmed = content.trim();
  let cursor = 0;
  while (trimmed && cursor < sourceText.length) {
    const index = sourceText.indexOf(trimmed, cursor);
    if (index < 0) return undefined;
    const window = sourceText.slice(Math.max(0, index - 64), index);
    const boundary = Math.max(
      window.lastIndexOf("。"),
      window.lastIndexOf("！"),
      window.lastIndexOf("？"),
      window.lastIndexOf("!"),
      window.lastIndexOf("?"),
      window.lastIndexOf("\n"),
    );
    const prefix = window.slice(boundary + 1);
    if (ATTRIBUTED_SPEECH_END_PATTERN.test(prefix)) return prefix;
    cursor = index + trimmed.length;
  }
  return undefined;
}

const ATTRIBUTED_SPEECH_END_PATTERN =
  /(?:说(?:道)?|问(?:道)?|答(?:道)?|回答|回应|解释|透露|告知|告诉|表示|补充|提醒|安慰|劝(?:说|慰)?|says?|said|asks?|asked|answers?|answered|explains?|explained|reveals?|revealed)[^。！？!?\n]{0,16}[：:，,]\s*$/iu;

function findBestSourceEvidence(value: string, sourceText: string) {
  const valueBigrams = new Set(chineseBigrams(value));
  return sourceText
    .split(/(?<=[。！？!?])/u)
    .map((sentence) => ({
      sentence: sentence.trim(),
      score: chineseBigrams(sentence).filter((bigram) => valueBigrams.has(bigram))
        .length,
    }))
    .filter((item) => item.sentence.length > 0)
    .sort((left, right) => right.score - left.score)[0]?.sentence ?? sourceText;
}

function chineseBigrams(value: string) {
  const characters = Array.from(value.replace(/[^\u4e00-\u9fff]/g, ""));
  return characters.slice(1).map((character, index) => `${characters[index]}${character}`);
}

function expandFilmableStateChanges(
  action: Extract<ScreenplayContent, { type: "action" }>,
  characters: readonly string[],
  actorHint?: string,
  sourceText?: string,
): ScreenplayContent[] {
  const speaker =
    firstMentionedCharacter(action.text, characters) ??
    lastMentionedCharacter(action.text, characters) ??
    actorHint;
  if (!speaker) return [action];
  const additions: ScreenplayContent[] = [];
  const retrieval = /从([^，。；;]+?)(?:中)?取出([^，。；;]+?)(?:[，。；;]|$)/.exec(
    action.text,
  );
  if (retrieval) {
    const container = retrieval[1].trim();
    additions.push({
      type: "action",
      text: `${speaker}走到${container}前，伸手靠近${container}。`,
      origin: "bridge",
      evidence: [findBestSourceEvidence(action.text, sourceText ?? action.text)],
    });
  }
  additions.push(action);

  const holding = /双手捧起([^，。；;]+?)(?:[，。；;]|$)/.exec(action.text);
  if (holding) {
    const prop = holding[1].trim();
    additions.push({
      type: "action",
      text: `${speaker}将${prop}稳稳托在双手间，转向眼前的人。`,
      origin: "bridge",
      evidence: [findBestSourceEvidence(action.text, sourceText ?? action.text)],
    });
  }
  return additions;
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
  actorHint?: string,
): ScreenplayContent[] {
  const pattern = /(?:若|如果)(?:自己|我)[^。！？!?]+[。！？!?]?/g;
  const result: ScreenplayContent[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const before = text.slice(cursor, index);
    const speaker = lastMentionedCharacter(before, characters) ?? actorHint;
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

function firstMentionedCharacter(text: string, characters: readonly string[]) {
  return characters
    .map((name) => ({ name, index: text.indexOf(name) }))
    .filter((item) => item.index >= 0)
    .sort((left, right) => left.index - right.index)[0]?.name;
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
    "说(?:道)?|问(?:道)?|答(?:道)?|回答|回应|喊(?!一声)(?:道)?|叫(?!(?:进|到|来|住|醒|一声))(?:道)?|喝(?!一声)(?:道)?|叹(?!一声)(?:道)?|笑(?:道)?|开口|低声(?:说)?|轻声(?:说)?|安慰|劝(?:说|慰)?|安抚|鼓励";
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
