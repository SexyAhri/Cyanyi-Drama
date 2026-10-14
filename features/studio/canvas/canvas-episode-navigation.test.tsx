import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { canvasEpisodeNavigation, switchCanvasEpisode } from "./canvas-episode-navigation";
import { CanvasEpisodeSwitcher } from "./canvas-episode-switcher";
import { CanvasNode } from "./canvas-node";

const episodes = [{ id: "third", episodeNumber: 3, name: "第三集" }, { id: "first", episodeNumber: 1, name: "开场" }, { id: "seventh", episodeNumber: 7, name: "结尾" }];

describe("canvas episode navigation", () => {
  it("orders episodes and navigates existing neighbors across numbering gaps", () => {
    expect(canvasEpisodeNavigation(episodes, "third")).toMatchObject({ previous: episodes[1], next: episodes[2] });
    expect(episodes[0].id).toBe("third");
  });
  it("disables unavailable neighbors at boundaries and for a single episode", () => {
    expect(canvasEpisodeNavigation(episodes, "first").previous).toBeUndefined();
    expect(canvasEpisodeNavigation(episodes, "seventh").next).toBeUndefined();
    expect(canvasEpisodeNavigation([episodes[0]], "third")).toMatchObject({ previous: undefined, next: undefined });
    expect(canvasEpisodeNavigation(episodes, "deleted")).toMatchObject({ previous: undefined, next: undefined });
  });
  it("waits for the current canvas save before navigating", async () => {
    let complete!: (saved: boolean) => void;
    const navigate = vi.fn();
    const switched = switchCanvasEpisode("episode=first&view=canvas&stage=assets&locale=en&panel=old&task=old&run=old", "third", () => new Promise(resolve => { complete = resolve; }), navigate);
    expect(navigate).not.toHaveBeenCalled(); complete(true); expect(await switched).toBe(true);
    const params = new URLSearchParams(navigate.mock.calls[0][0]);
    expect(params.get("episode")).toBe("third"); expect(params.get("view")).toBe("canvas");
    expect(params.get("stage")).toBe("assets"); expect(params.get("locale")).toBe("en");
    for (const key of ["panel", "task", "run"]) expect(params.has(key)).toBe(false);
  });
  it("stays on the current episode when saving fails", async () => {
    const navigate = vi.fn();
    expect(await switchCanvasEpisode("episode=first", "third", async () => false, navigate)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
  it("does not navigate when the leave guard rejects", async () => {
    const navigate = vi.fn();
    await expect(switchCanvasEpisode("", "third", async () => { throw new Error("blocked"); }, navigate)).rejects.toThrow("blocked");
    expect(navigate).not.toHaveBeenCalled();
  });
  it("renders project dropdown and labeled compact navigation in Chinese", () => {
    const html = renderToStaticMarkup(<CanvasEpisodeSwitcher episodes={episodes} episodeId="first" locale="zh-CN" disabled={false} onSelect={async () => {}} />);
    expect(html).toContain('aria-label="上一集"'); expect(html).toContain('aria-label="下一集"');
    expect(html).toContain('aria-label="选择剧集"'); expect(html).toContain("第 1 集");
    expect(html).toContain('data-slot="select-trigger"');
    expect(html).toMatch(/<button[^>]*aria-label="上一集"[^>]*disabled/);
    expect(html).toContain("sm:w-auto"); expect(html).toContain("max-w-[calc(100vw-7rem)]");
  });
  it("renders English labels and locks navigation during saving or generation", () => {
    const html = renderToStaticMarkup(<CanvasEpisodeSwitcher episodes={episodes} episodeId="third" locale="en" disabled onSelect={async () => {}} />);
    expect(html).toContain("Episode 3"); expect(html).toContain('aria-label="Next episode"');
    expect(html).toMatch(/<button[^>]*aria-label="Previous episode"[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*aria-label="Next episode"[^>]*disabled/);
  });
  it("shows a visual design without pretending an image was generated", () => {
    const html = renderToStaticMarkup(<CanvasNode node={{ id: "location", kind: "location", title: "场景", entityId: "entity", text: "设定", x: 0, y: 0 }}
      imageAvailability="设定已完成 · 图片未生成" selected={false} connecting={false} target={false} locale="zh-CN"
      onSelect={() => {}} onDrag={() => {}} onConnect={() => {}} onComplete={() => {}} onBranch={() => {}} busy={false} inputs={[]} />);
    expect(html).toContain("设定已完成 · 图片未生成"); expect(html).not.toContain("已有素材");
  });
});
