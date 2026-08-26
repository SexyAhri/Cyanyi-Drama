import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/prisma", () => ({ prisma: {} }));

import { normalizeContinuityArtifacts } from "./continuity-store";

describe("storyboard continuity artifacts", () => {
  it("normalizes valid issues and ignores failed or malformed artifacts", () => {
    const issues = normalizeContinuityArtifacts([
      {
        refId: "clip-1",
        payload: {
          success: true,
          data: {
            issues: [
              {
                code: "WARDROBE_DRIFT",
                severity: "warning",
                panelIndex: 2,
                entityType: "character",
                entityName: "Lin",
                message: "Jacket color changed.",
                suggestedFix: "Keep the jacket dark.",
              },
              { code: "BROKEN" },
            ],
          },
        },
      },
      {
        refId: "clip-2",
        payload: { success: false, data: { issues: [] } },
      },
    ]);

    expect(issues).toEqual([
      {
        clipId: "clip-1",
        code: "WARDROBE_DRIFT",
        severity: "warning",
        panelIndex: 2,
        entityType: "character",
        entityName: "Lin",
        message: "Jacket color changed.",
        suggestedFix: "Keep the jacket dark.",
      },
    ]);
  });
});
