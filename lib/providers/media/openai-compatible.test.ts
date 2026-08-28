import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithProviderRetry = vi.hoisted(() => vi.fn());

vi.mock("@/lib/providers/http", () => ({ fetchWithProviderRetry }));

import { openAiCompatibleMediaProvider } from "./openai-compatible";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible media provider", () => {
  it("embeds reference images before calling an external image endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(Uint8Array.from([137, 80, 78, 71]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      ),
    );
    fetchWithProviderRetry.mockResolvedValue(
      Response.json({ data: [{ url: "https://cdn.test/shot.png" }] }),
    );

    await openAiCompatibleMediaProvider.generate({
      protocol: "openai-compatible",
      providerKey: "custom",
      baseUrl: "https://provider.test/v1",
      apiKey: "key-1",
      model: "gpt-image-2",
      kind: "image",
      request: {
        prompt: "cinematic shot",
        ratio: "16:9",
        referenceImages: [
          {
            url: "http://localhost:3000/api/files/reference.png",
            mimeType: "image/png",
          },
        ],
      },
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/files/reference.png",
      { cache: "no-store" },
    );
    expect(fetchWithProviderRetry.mock.calls[0][0]).toBe(
      "https://provider.test/v1/images/edits",
    );
    const requestBody = fetchWithProviderRetry.mock.calls[0][1].body as FormData;
    expect(requestBody).toBeInstanceOf(FormData);
    expect(requestBody.get("model")).toBe("gpt-image-2");
    expect(requestBody.getAll("image[]")).toHaveLength(1);
  });

  it("does not silently discard references when the provider rejects them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(Uint8Array.from([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      ),
    );
    fetchWithProviderRetry.mockResolvedValue(
      Response.json(
        { error: { message: "reference images are not supported" } },
        { status: 400 },
      ),
    );

    await expect(
      openAiCompatibleMediaProvider.generate({
        protocol: "openai-compatible",
        providerKey: "custom",
        baseUrl: "https://provider.test/v1",
        apiKey: "key-1",
        model: "gpt-image-2",
        kind: "image",
        request: {
          prompt: "shot",
          referenceImages: [
            { url: "http://localhost:3000/api/files/reference.png" },
          ],
        },
      }),
    ).rejects.toThrow("reference images are not supported");
    expect(fetchWithProviderRetry).toHaveBeenCalledTimes(1);
  });
});
