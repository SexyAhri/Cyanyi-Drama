import { screenplayConversionSchema } from "@/lib/prompts/schemas";
import { estimateSpeechDurationSeconds } from "@/lib/prompts/validators";

import type { StoryboardRecord } from "./domain-types";

export type StoryboardReviewIssue = {
  code:
    | "SOURCE_EVENT_MISSING"
    | "SCREENPLAY_ACTION_MISSING"
    | "DIALOGUE_MISSING"
    | "VOICEOVER_MISSING"
    | "MULTI_SPEAKER_SHOT"
    | "DIALOGUE_DURATION_OVERFLOW";
  severity: "error" | "warning";
  clipId: string;
  panelIndex: number | null;
  message: string;
};

export type StoryboardInferenceReview = {
  clipId: string;
  sceneNumber: number;
  text: string;
  inferenceType: "performance" | "continuity" | "production_detail";
  evidence: string[];
  rationale: string;
  confidence: number;
};

export type StoryboardContentReview = {
  status: "clear" | "needs_review";
  blockingIssueCount: number;
  issues: StoryboardReviewIssue[];
  inferences: StoryboardInferenceReview[];
  coverage: { total: number; covered: number; missingEventIds: string[] };
};

export function buildStoryboardContentReview(
  storyboard: StoryboardRecord | null,
  clips: Array<{ id: string; screenplay: string | null }>,
): StoryboardContentReview {
  const issues: StoryboardReviewIssue[] = [];
  const inferences: StoryboardInferenceReview[] = [];
  const missingEventIds: string[] = [];
  let coverageTotal = 0;
  let coverageCovered = 0;
  const panels = storyboard?.panels ?? [];

  for (const clip of clips) {
    const parsed = parseScreenplay(clip.screenplay);
    if (!parsed) continue;
    const clipPanels = panels.filter((panel) => panel.clipId === clip.id);
    const evidenceSet = new Set(
      clipPanels.flatMap((panel) => panel.sourceEvidence),
    );
    for (const event of parsed.coverage ?? []) {
      if (event.modes.includes("omitted")) continue;
      coverageTotal += 1;
      if (evidenceSet.has(event.evidence)) coverageCovered += 1;
      else {
        missingEventIds.push(event.eventId);
        issues.push({
          code: "SOURCE_EVENT_MISSING",
          severity: "error",
          clipId: clip.id,
          panelIndex: null,
          message: `原文事件 ${event.eventId} 没有对应分镜证据：${event.evidence}`,
        });
      }
    }

    for (const scene of parsed.scenes) {
      for (const content of scene.content) {
        if (content.type === "action") {
          const evidence = content.evidence ?? [content.text];
          if (!evidence.some((value) => evidenceSet.has(value)))
            issues.push({
              code: "SCREENPLAY_ACTION_MISSING",
              severity: "error",
              clipId: clip.id,
              panelIndex: null,
              message: `剧本动作没有对应镜头：${content.text}`,
            });
          if (
            content.origin === "inferred" &&
            content.inferenceType &&
            content.evidence?.length &&
            content.rationale &&
            content.confidence !== undefined
          )
            inferences.push({
              clipId: clip.id,
              sceneNumber: scene.sceneNumber,
              text: content.text,
              inferenceType: content.inferenceType,
              evidence: content.evidence,
              rationale: content.rationale,
              confidence: content.confidence,
            });
          continue;
        }
        const matchingPanels = clipPanels.filter((panel) =>
          content.type === "dialogue"
            ? panel.speakingCharacter === content.character &&
              Boolean(panel.lipSyncText) &&
              content.lines.includes(panel.lipSyncText ?? "")
            : Boolean(panel.voiceoverText) &&
              content.text.includes(panel.voiceoverText ?? ""),
        );
        const performed = matchingPanels
          .map((panel) =>
            content.type === "dialogue"
              ? (panel.lipSyncText ?? "")
              : (panel.voiceoverText ?? ""),
          )
          .join("");
        const expected =
          content.type === "dialogue" ? content.lines : content.text;
        if (performed !== expected)
          issues.push({
            code:
              content.type === "dialogue"
                ? "DIALOGUE_MISSING"
                : "VOICEOVER_MISSING",
            severity: "error",
            clipId: clip.id,
            panelIndex: matchingPanels[0]?.panelIndex ?? null,
            message: `${content.type === "dialogue" ? "对白" : "画外音"}未按原文完整覆盖：${expected}`,
          });
      }
    }

    for (const panel of clipPanels) {
      const activeSpeakers = parsed.scenes.flatMap((scene) =>
        scene.content.flatMap((content) =>
          content.type === "dialogue" &&
          `${panel.description ?? ""}\n${panel.videoPrompt ?? ""}\n${panel.lipSyncText ?? ""}`.includes(
            content.lines,
          )
            ? [content.character]
            : [],
        ),
      );
      if (new Set(activeSpeakers).size > 1)
        issues.push({
          code: "MULTI_SPEAKER_SHOT",
          severity: "error",
          clipId: clip.id,
          panelIndex: panel.panelIndex,
          message: "同一镜头包含多名角色的开口台词，需要在说话人变化处拆镜。",
        });
      const spoken = panel.lipSyncText ?? panel.voiceoverText;
      if (
        spoken &&
        (panel.durationSeconds ?? 0) < estimateSpeechDurationSeconds(spoken)
      )
        issues.push({
          code: "DIALOGUE_DURATION_OVERFLOW",
          severity: "error",
          clipId: clip.id,
          panelIndex: panel.panelIndex,
          message: `台词至少需要 ${estimateSpeechDurationSeconds(spoken)} 秒，当前镜头时长不足。`,
        });
    }
  }

  const blockingIssueCount = issues.filter(
    (item) => item.severity === "error",
  ).length;
  return {
    status: blockingIssueCount || inferences.length ? "needs_review" : "clear",
    blockingIssueCount,
    issues,
    inferences,
    coverage: {
      total: coverageTotal,
      covered: coverageCovered,
      missingEventIds,
    },
  };
}

function parseScreenplay(value: string | null) {
  if (!value) return null;
  try {
    const parsed = screenplayConversionSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
