import type { StoryboardContinuityIssue } from "@/lib/novel/continuity-store";

import type { StudioStoryboardPanel } from "../types";

export function getPanelContinuityIssues(
  panel: StudioStoryboardPanel,
  issues: StoryboardContinuityIssue[],
) {
  return issues.filter(
    (issue) =>
      issue.clipId === panel.clipId &&
      issue.panelIndex !== null &&
      issue.panelIndex === panel.clipPanelIndex,
  );
}

export function replaceStoryboardPanel(
  panels: StudioStoryboardPanel[],
  next: StudioStoryboardPanel,
) {
  return panels.map((panel) => (panel.id === next.id ? next : panel));
}
