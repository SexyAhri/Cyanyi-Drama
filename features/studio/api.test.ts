import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adaptStudioEpisode,
  deleteStudioEpisodeAudioTrack,
  generateStudioAssetVisualProfile,
  updateStudioEpisodeAudioTrack,
  uploadStudioEpisodeAudioTrack,
  loadStudioAssetCatalog,
  loadStudioStoryboard,
} from "./api";
import { invalidateStudioCache, setStudioCacheScope } from "./request-cache";

describe("workflow output catalog refresh", () => {
  afterEach(() => { invalidateStudioCache(undefined, true); vi.unstubAllGlobals(); });
  it("refreshes every shared catalog page and storyboard after output changes", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { documentElement: { lang: "zh-CN" } });
    setStudioCacheScope("catalog-refresh-test");
    invalidateStudioCache(undefined, true);
    let version = "old";
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async input => {
      const url = String(input);
      const body = url.endsWith("/characters") ? { characters: [] }
        : url.endsWith("/locations") ? { locations: [] }
          : url.endsWith("/props") ? { props: [] }
            : url.endsWith("/storyboard") ? { storyboard: { version } }
              : { assets: [{ id: url.includes("cursor=") ? `${version}-page2` : version }], nextCursor: url.includes("cursor=") ? null : "second" };
      return Response.json(body);
    });
    vi.stubGlobal("fetch", fetchMock);
    expect((await loadStudioAssetCatalog("project-cache")).assets.map(asset => asset.id)).toEqual(["old", "old-page2"]);
    await loadStudioStoryboard("project-cache", "episode");
    version = "new";
    expect((await loadStudioAssetCatalog("project-cache")).assets[0].id).toBe("old");
    expect((await loadStudioAssetCatalog("project-cache", undefined, true)).assets.map(asset => asset.id)).toEqual(["new", "new-page2"]);
    expect((await loadStudioStoryboard("project-cache", "episode", undefined, true)).storyboard).toMatchObject({ version: "new" });
    expect(fetchMock.mock.calls.slice(-6).every(([, init]) => init?.cache === "no-store")).toBe(true);
  });
});

describe("studio adaptation stream", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards live content and resolves the completed source", async () => {
    const source = {
      id: "source-adapted-1",
      content: "完整改编稿",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          [
            JSON.stringify({ type: "started", workflowId: "workflow-1" }),
            JSON.stringify({ type: "phase", phase: "generating" }),
            JSON.stringify({ type: "reset" }),
            JSON.stringify({ type: "delta", delta: "第一段" }),
            JSON.stringify({ type: "phase", phase: "saving" }),
            JSON.stringify({ type: "delta", delta: "\n第二段" }),
            JSON.stringify({ type: "completed", source }),
            "",
          ].join("\n"),
          { status: 200 },
        ),
      ),
    );
    const onReset = vi.fn();
    const onContent = vi.fn();
    const onPhase = vi.fn();
    const onWorkflowStarted = vi.fn();

    const result = await adaptStudioEpisode(
      "project-1",
      "episode-1",
      {
        channelId: "channel-1",
        model: "model-1",
        mode: "polish",
        locale: "zh",
      },
      { onReset, onContent, onPhase, onWorkflowStarted },
    );

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onContent.mock.calls.map(([content]) => content)).toEqual([
      "第一段",
      "第一段\n第二段",
    ]);
    expect(onPhase.mock.calls.map(([phase]) => phase)).toEqual([
      "generating",
      "saving",
    ]);
    expect(onWorkflowStarted).toHaveBeenCalledWith("workflow-1");
    expect(result.source).toEqual(source);
  });

  it("surfaces a streamed workflow failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          `${JSON.stringify({
            type: "failed",
            message: "模型请求失败，请在任务列表重试。",
          })}\n`,
          { status: 200 },
        ),
      ),
    );

    await expect(
      adaptStudioEpisode("project-1", "episode-1", {
        channelId: "channel-1",
        model: "model-1",
        mode: "polish",
        locale: "zh",
      }),
    ).rejects.toThrow("模型请求失败，请在任务列表重试");
  });
});

describe("studio asset visual design stream", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("announces the workflow and resolves a permissive visual profile", async () => {
    const profile = {
      version: 1,
      source: "model",
      updatedAt: "2026-09-01T10:00:00.000Z",
      spec: {
        visualIdentity: "病弱而温和的中年男子",
        shapeAndStructure: "",
        surfaceAndStyling: "深灰旧袍",
        colorPalette: "",
        lightingAndPresentation: "",
        signatureDetails: [],
        consistencyRules: ["保持剑眉与苍白脸色"],
        negativePrompt: "",
        inferenceNotes: [],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          [
            JSON.stringify({
              type: "started",
              workflowId: "workflow-visual-1",
            }),
            JSON.stringify({
              type: "completed",
              target: { id: "character-1", type: "character", name: "韩子枫" },
              profile,
            }),
            "",
          ].join("\n"),
          { status: 200 },
        ),
      ),
    );
    const onWorkflowStarted = vi.fn();

    const result = await generateStudioAssetVisualProfile(
      "project-1",
      {
        targetType: "character",
        targetId: "character-1",
        channelId: "channel-1",
        model: "model-1",
        locale: "zh",
      },
      { onWorkflowStarted },
    );

    expect(onWorkflowStarted).toHaveBeenCalledWith("workflow-visual-1");
    expect(result.profile.spec.consistencyRules).toEqual([
      "保持剑眉与苍白脸色",
    ]);
  });
});

describe("studio episode audio tracks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uploads an independent track with its mix settings", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ asset: { id: "asset-1" }, track: { id: "track-1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["audio"], "rain.wav", { type: "audio/wav" });

    await uploadStudioEpisodeAudioTrack("project 1", "episode/1", {
      file,
      trackType: "ambience",
      startSeconds: 1.5,
      endSeconds: 12,
      volume: 0.35,
      loop: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "/api/projects/project%201/episodes/episode%2F1/audio/tracks",
    );
    expect(init).toMatchObject({ credentials: "same-origin", method: "POST" });
    const form = init?.body as FormData;
    expect(form.get("file")).toBe(file);
    expect(form.get("trackType")).toBe("ambience");
    expect(form.get("startSeconds")).toBe("1.5");
    expect(form.get("endSeconds")).toBe("12");
    expect(form.get("volume")).toBe("0.35");
    expect(form.get("loop")).toBe("true");
  });

  it("updates and removes tracks within the selected episode", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ track: { id: "track 1" } }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await updateStudioEpisodeAudioTrack("project-1", "episode-1", {
      id: "track 1",
      startSeconds: 2,
      endSeconds: null,
      volume: 0.8,
      loop: false,
    });
    await deleteStudioEpisodeAudioTrack(
      "project-1",
      "episode-1",
      "track 1",
    );

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/projects/project-1/episodes/episode-1/audio/tracks",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "same-origin",
      method: "PATCH",
      body: JSON.stringify({
        id: "track 1",
        startSeconds: 2,
        endSeconds: null,
        volume: 0.8,
        loop: false,
      }),
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/projects/project-1/episodes/episode-1/audio/tracks?id=track+1",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      credentials: "same-origin",
      method: "DELETE",
    });
  });
});
