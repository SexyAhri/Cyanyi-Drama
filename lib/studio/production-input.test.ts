import { describe, expect, it } from "vitest";
import { isSerialStorySetup, resolveStorySetup, storySetupSchema } from "./production-input";

describe("story setup carried into production", () => {
  it("freezes user premises and later changes without adopting assistant inventions", () => {
    const setup = resolveStorySetup({ projectName: "山村", request: "生成一百集的大纲，先别完结", artStyle: "realistic",
      options: { storySetup: storySetupSchema.parse({ storyIdea: "东北种田", episodeCount: 20 }) },
      conversation: [
        { role: "user", content: "1964年黑龙江，断亲住山洞，空间种田，慢热治愈长篇连载" },
        { role: "assistant", content: "建议改成现代都市职场争斗，主角叫王强" },
      ],
    });
    expect(setup.episodeCount).toBe(100);
    expect(setup.storyIdea).toContain("1964年黑龙江");
    expect(setup.storyIdea).toContain("先别完结");
    expect(setup.storyIdea).not.toContain("王强");
    expect(setup.genres).toEqual([]);
    expect(setup.structure).toBe("自动适配");
    expect(isSerialStorySetup(setup)).toBe(true);
  });
  it("does not turn episode references or ranges into requested series lengths", () => {
    expect(resolveStorySetup({ projectName: "测试", request: "第5集的结尾我想改一下" }).episodeCount).toBe(20);
    expect(resolveStorySetup({ projectName: "测试", request: "第一阶段1–60集，长期做几百集" }).episodeCount).toBe(20);
    expect(resolveStorySetup({ projectName: "测试", request: "写30 episodes" }).episodeCount).toBe(30);
    expect(resolveStorySetup({ projectName: "测试", request: "生成二十五集" }).episodeCount).toBe(25);
  });
  it("retains a preset and gives explicit recent user directions priority", () => {
    const setup = resolveStorySetup({ projectName: "测试", request: "改为40集单元结构，保留小人物设定",
      options: { storySetup: storySetupSchema.parse({ storyIdea: "修理师追查旧物", structure: "三幕式", episodeCount: 20 }) } });
    expect(setup.episodeCount).toBe(40);
    expect(setup.structure).toBe("单元结构");
    expect(setup.storyIdea).toContain("修理师追查旧物");
    expect(setup.storyIdea).toContain("保留小人物设定");
  });
  it("bounds long conversations while retaining the premise and newest request", () => {
    const setup = resolveStorySetup({ projectName: "测试", request: "新要求：改到东北",
      conversation: [{ role: "user", content: `原始人物：猎户${"旧讨论".repeat(2500)}` }] });
    expect(setup.storyIdea.length).toBeLessThanOrEqual(4000);
    expect(setup.storyIdea).toContain("原始人物：猎户");
    expect(setup.storyIdea).toContain("新要求：改到东北");
    expect(setup.storyIdea).toContain("已截取");
  });
  it("keeps a user's earlier explicit revision when the latest message only confirms generation", () => {
    const setup = resolveStorySetup({ projectName: "山村", request: "就按这个生成",
      options: { storySetup: storySetupSchema.parse({ episodeCount: 20, structure: "三幕式" }) },
      conversation: [{ role: "user", content: "改成一百集长线阶段式，慢慢种田，别急着完结" }],
    });
    expect(setup.episodeCount).toBe(100);
    expect(setup.structure).toBe("长线阶段式");
  });
});
