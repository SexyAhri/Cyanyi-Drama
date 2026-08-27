import { describe, expect, it } from "vitest";

import {
  getStageCopy,
  getStageStatusCopy,
  getStudioCopy,
} from "./i18n";
import { STUDIO_STAGE_IDS } from "./stage-state";
import type { StudioLocale, StudioStageStatus } from "./types";

const locales: StudioLocale[] = ["zh-CN", "en"];
const statuses: StudioStageStatus[] = [
  "not_started",
  "ready",
  "running",
  "paused",
  "completed",
  "canceled",
  "failed",
  "blocked",
];

describe("studio i18n", () => {
  it.each(locales)("provides complete non-empty copy for %s", (locale) => {
    expect(Object.values(getStudioCopy(locale))).not.toContain("");

    for (const stageId of STUDIO_STAGE_IDS) {
      expect(getStageCopy(locale, stageId).short.trim()).not.toBe("");
      expect(getStageCopy(locale, stageId).title.trim()).not.toBe("");
    }

    for (const status of statuses) {
      expect(getStageStatusCopy(locale, status).trim()).not.toBe("");
    }
  });
});
