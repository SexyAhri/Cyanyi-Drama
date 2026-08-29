import { describe, expect, it } from "vitest";

import { normalizeAuthRedirect } from "./redirect";

describe("normalizeAuthRedirect", () => {
  it("preserves internal project paths and query strings", () => {
    expect(
      normalizeAuthRedirect(
        "/projects/project-1?episode=episode-2&stage=storyboard",
      ),
    ).toBe("/projects/project-1?episode=episode-2&stage=storyboard");
  });

  it.each([
    undefined,
    null,
    "",
    "https://example.com/projects",
    "//example.com/projects",
    "/login",
    "/login?next=/projects",
  ])("falls back for unsafe target %s", (target) => {
    expect(normalizeAuthRedirect(target)).toBe("/projects");
  });
});
