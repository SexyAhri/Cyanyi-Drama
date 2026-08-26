import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeOpenAiCompatibleMediaTemplate,
  parseOpenAiCompatibleMediaTemplate,
  renderTemplateBody,
  type OpenAiCompatibleMediaTemplate,
} from "./openai-compatible-media-template";

describe("OpenAI-compatible media templates", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("omits only explicitly configured empty fields", () => {
    const rendered = renderTemplateBody(
      {
        method: "POST",
        path: "images/generate",
        bodyTemplate: {
          model: "{{model}}",
          image: "{{image}}",
          optional: null,
          zero: 0,
          enabled: false,
          nested: { images: "{{images}}", keep: "" },
        },
        omitEmptyBodyFields: ["image", "optional", "nested.images"],
      },
      {
        model: "custom-image",
        image: "",
        images: [],
      },
    );

    expect(rendered).toEqual({
      model: "custom-image",
      zero: 0,
      enabled: false,
      nested: { keep: "" },
    });
  });

  it("executes a synchronous template and maps output arrays", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ url: "https://cdn.test/a.png" }, { url: "https://cdn.test/b.png" }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const template = syncTemplate();

    const assets = await executeOpenAiCompatibleMediaTemplate({
      baseUrl: "https://provider.test/v1",
      apiKey: "secret",
      model: "custom-image",
      kind: "image",
      request: { prompt: "portrait", referenceImages: [] },
      template,
    });

    expect(assets.map((asset) => asset.url)).toEqual([
      "https://cdn.test/a.png",
      "https://cdn.test/b.png",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://provider.test/v1/images/generate");
    const request = fetchMock.mock.calls[0][1]!;
    expect(request.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(JSON.parse(String(request.body))).toEqual({
      model: "custom-image",
      prompt: "portrait",
    });
  });

  it("polls an asynchronous template without Worker-specific provider code", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "task-1" }), { status: 202 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            state: "running",
            output: { url: "https://cdn.test/preview.mp4" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ state: "completed", output: { url: "https://cdn.test/video.mp4" } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const template: OpenAiCompatibleMediaTemplate = {
      version: 1,
      mediaType: "video",
      mode: "async",
      create: {
        method: "POST",
        path: "videos",
        bodyTemplate: { model: "{{model}}", prompt: "{{prompt}}" },
      },
      status: { method: "GET", path: "videos/{{task_id}}" },
      response: {
        taskIdPath: "$.id",
        statusPath: "$.state",
        outputUrlPath: "$.output.url",
      },
      polling: {
        intervalMs: 100,
        timeoutMs: 2_000,
        doneStates: ["completed"],
        failStates: ["failed"],
      },
    };

    const output = await executeOpenAiCompatibleMediaTemplate({
      baseUrl: "https://provider.test/v1",
      apiKey: "secret",
      model: "custom-video",
      kind: "video",
      request: { prompt: "camera move" },
      template,
      sleep: async () => undefined,
    });

    expect(output[0].url).toBe("https://cdn.test/video.mp4");
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://provider.test/v1/videos",
      "https://provider.test/v1/videos/task-1",
      "https://provider.test/v1/videos/task-1",
    ]);
  });

  it("rejects cross-origin template endpoints", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());
    await expect(
      executeOpenAiCompatibleMediaTemplate({
        baseUrl: "https://provider.test/v1",
        apiKey: "secret",
        model: "custom-image",
        kind: "image",
        request: { prompt: "portrait" },
        template: {
          ...syncTemplate(),
          create: {
            ...syncTemplate().create,
            path: "https://untrusted.test/collect",
          },
        },
      }),
    ).rejects.toThrow("CROSS_ORIGIN_PATH_REJECTED");
  });

  it("requires async task and status mappings", () => {
    expect(() =>
      parseOpenAiCompatibleMediaTemplate({
        ...syncTemplate(),
        mode: "async",
      }),
    ).toThrow();
  });
});

function syncTemplate(): OpenAiCompatibleMediaTemplate {
  return {
    version: 1,
    mediaType: "image",
    mode: "sync",
    create: {
      method: "POST",
      path: "images/generate",
      bodyTemplate: {
        model: "{{model}}",
        prompt: "{{prompt}}",
        image: "{{image}}",
      },
      omitEmptyBodyFields: ["image"],
    },
    response: { outputUrlsPath: "$.data" },
  };
}
