import { describe, expect, it } from "vitest";

import { getDeliverableTemplate } from "./deliverable-dialogs";

describe("art deliverable templates", () => {
  it.each([
    "visual_bible",
    "color_script",
    "character_design",
    "environment_design",
    "prop_costume_design",
  ])("provides production-ready defaults for %s", (type) => {
    const template = getDeliverableTemplate("zh-CN", type);

    expect(template.title).not.toBe("");
    expect(template.purpose).not.toBe("");
    expect(template.summary).not.toBe("");
    expect(template.directives.length).toBeGreaterThan(0);
    expect(template.constraints.length).toBeGreaterThan(0);
  });
});
