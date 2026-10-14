import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithProviderRetry = vi.hoisted(() => vi.fn());

vi.mock("@/lib/providers/http", () => ({ fetchWithProviderRetry }));
vi.mock("./shared", async importOriginal => {
  const actual = await importOriginal<typeof import("./shared")>();
  return { ...actual, waitForProviderPoll: async () => undefined };
});

import { volcengineArkMediaProvider } from "./volcengine-ark";

beforeEach(() => {
  vi.clearAllMocks();
  fetchWithProviderRetry.mockResolvedValue(
    Response.json({ content: { video_url: "https://cdn.test/shot.mp4" } }),
  );
});

describe("Volcengine Ark video audio policy", () => {
  it.each([
    ["full", true],
    ["ambient_only", true],
    ["none", false],
  ] as const)("maps %s to generate_audio=%s", async (audioMode, generateAudio) => {
    await volcengineArkMediaProvider.generate({
      protocol: "volcengine-ark",
      providerKey: "volcengine",
      baseUrl: "https://ark.test/api/v3",
      apiKey: "key-1",
      model: "video-model",
      kind: "video",
      request: {
        prompt: "生成与动作同步的环境声和动作音效，不生成人声",
        duration: "5s",
        audioMode,
      },
    });

    const body = JSON.parse(fetchWithProviderRetry.mock.calls[0][1].body as string);
    expect(body.generate_audio).toBe(generateAudio);
  });

  it("persists the provider task id before polling and records generation phase", async () => {
    fetchWithProviderRetry
      .mockResolvedValueOnce(Response.json({ data: { id: "ark-task-1", status: "queued" } }))
      .mockResolvedValueOnce(Response.json({ data: { id: "ark-task-1", status: "succeeded", video_url: "https://cdn.test/final.mp4" } }));
    const phases: string[] = [];
    const providerTaskIds: string[] = [];

    const output = await volcengineArkMediaProvider.generate({
      protocol: "volcengine-ark",
      providerKey: "volcengine",
      baseUrl: "https://ark.test/api/v3",
      apiKey: "key-1",
      model: "video-model",
      kind: "video",
      request: { prompt: "test", duration: "5s" },
      onExecutionPhase: async phase => { phases.push(phase); },
      onProviderTaskId: async taskId => { providerTaskIds.push(taskId); },
    });

    expect(providerTaskIds).toEqual(["ark-task-1"]);
    expect(phases).toEqual(["request_sent", "submitted", "generating"]);
    expect(fetchWithProviderRetry).toHaveBeenCalledTimes(2);
    expect(output[0]).toMatchObject({ url: "https://cdn.test/final.mp4" });
  });

  it("resumes polling by provider task id without submitting a duplicate generation request", async () => {
    fetchWithProviderRetry.mockResolvedValueOnce(
      Response.json({ data: { id: "ark-task-existing", status: "succeeded", video_url: "https://cdn.test/resumed.mp4" } }),
    );
    const phases: string[] = [];
    const output = await volcengineArkMediaProvider.resume!(
      {
        protocol: "volcengine-ark",
        providerKey: "volcengine",
        baseUrl: "https://ark.test/api/v3",
        apiKey: "key-1",
        model: "video-model",
        kind: "video",
        request: { prompt: "original frozen input" },
        onExecutionPhase: async phase => { phases.push(phase); },
      },
      "ark-task-existing",
    );

    expect(fetchWithProviderRetry).toHaveBeenCalledOnce();
    expect(String(fetchWithProviderRetry.mock.calls[0][0])).toContain("ark-task-existing");
    expect(fetchWithProviderRetry.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer key-1" },
    });
    expect(fetchWithProviderRetry.mock.calls[0][1]).not.toHaveProperty("method", "POST");
    expect(phases).toEqual(["generating"]);
    expect(output[0]?.url).toBe("https://cdn.test/resumed.mp4");
  });
});
