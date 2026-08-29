import { describe, expect, it } from "vitest";

import {
  applyProjectArtStyle,
  getProjectArtStyleDirective,
  getProjectArtStyleLabel,
  isProjectArtStyleId,
} from "./art-style";

describe("project art style", () => {
  it("resolves explicit localized labels", () => {
    expect(getProjectArtStyleLabel("chinese-ink", "zh-CN")).toBe("中国水墨动画");
    expect(getProjectArtStyleLabel("american-comic", "en")).toBe("American comic");
  });

  it("builds a project-wide non-mixing constraint", () => {
    const directive = getProjectArtStyleDirective("chinese-comic", "zh");
    expect(directive).toContain("最高优先级");
    expect(directive).toContain("所有角色、场景、道具、分镜图和视频");
    expect(directive).toContain("禁止自行推断、切换或混入");
  });

  it("places the hard style constraint before a generation prompt", () => {
    const prompt = applyProjectArtStyle("角色站在山门前", "japanese-anime", "zh");
    expect(prompt.indexOf("项目统一画风")).toBeLessThan(
      prompt.indexOf("角色站在山门前"),
    );
  });

  it("recognizes only supported selectable styles", () => {
    expect(isProjectArtStyleId("stylized-3d")).toBe(true);
    expect(isProjectArtStyleId("ink animation")).toBe(false);
  });
});
