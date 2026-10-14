import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ assert: vi.fn(), resolve: vi.fn() }));
vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  assertConfigurationScope: mocks.assert,
  resolveProductionConfiguration: mocks.resolve,
}));
import {
  assertPreviewConfiguration,
  productionConfigurationFingerprint,
  productionRequestOptionsSchema,
  resolveProductionRequestConfiguration,
  mediaRequestPreviewFingerprint,
  assertPreviewRequest,
} from "./execution";
import {
  mergeProductionConfigurations,
  type ProductionConfigurationSnapshot,
} from "./contract";

const published: ProductionConfigurationSnapshot = {
  ...mergeProductionConfigurations([
    { sound: { music: "off", dialogue: false } },
  ]),
  format: "production-configuration-v1",
  sources: [
    {
      scopeKey: "panel:p",
      version: 2,
      fields: ["sound.music", "sound.dialogue"],
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.assert.mockResolvedValue(undefined);
  mocks.resolve.mockResolvedValue(structuredClone(published));
});
describe("request configuration", () => {
  it("pins prompts, parameters and stable reference identities from preview to execution", () => {
    const original = [
      {
        model: "video",
        channelId: "channel",
        request: {
          prompt: "Confirmed",
          productionConfiguration: published,
          duration: "5s",
          ratio: "16:9",
          referenceImages: [
            {
              url: "https://signed/first",
              storageKey: "asset-key",
              role: "first_frame",
            },
          ],
        },
      },
    ];
    const hash = mediaRequestPreviewFingerprint(original);
    expect(
      mediaRequestPreviewFingerprint([
        {
          ...original[0],
          request: {
            ...original[0].request,
            generationId: "new",
            referenceImages: [
              {
                url: "https://signed/changed",
                storageKey: "asset-key",
                role: "first_frame",
              },
            ],
          },
        },
      ]),
    ).toBe(hash);
    for (const request of [
      { ...original[0].request, prompt: "Changed" },
      { ...original[0].request, duration: "8s" },
      {
        ...original[0].request,
        referenceImages: [
          {
            url: "https://signed/first",
            storageKey: "new-key",
            role: "first_frame",
          },
        ],
      },
    ])
      expect(() =>
        assertPreviewRequest(
          mediaRequestPreviewFingerprint([{ ...original[0], request }]),
          hash,
        ),
      ).toThrow("重新预览");
  });
  it("inherits published settings when no override is supplied", async () => {
    expect(
      await resolveProductionRequestConfiguration("u", {
        projectId: "pr",
        episodeId: "e",
        panelId: "p",
      }),
    ).toEqual(published);
    expect(mocks.assert).toHaveBeenCalledWith("u", {
      projectId: "pr",
      episodeId: "e",
      panelId: "p",
    });
  });
  it("rejects every request-level override, including valid legacy fields", () => {
    for (const productionOverride of [
      {},
      { sound: { mode: "silent" } },
      { agents: {} },
      { workflow: { concurrency: 4 } },
    ]) {
      expect(
        productionRequestOptionsSchema.safeParse({ productionOverride })
          .success,
      ).toBe(false);
    }
  });
  it("does not read configuration from an unauthorized scope", async () => {
    mocks.assert.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      resolveProductionRequestConfiguration("other", { projectId: "pr" }),
    ).rejects.toThrow("Forbidden");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("rejects invalid request fields and forged snapshots", async () => {
    expect(
      productionRequestOptionsSchema.safeParse({
        productionOverride: published,
      }).success,
    ).toBe(false);
    expect(
      productionRequestOptionsSchema.safeParse({
        productionOverride: { workflow: { concurrency: 99 } },
      }).success,
    ).toBe(false);
  });
  it("accepts the same preview snapshot and rejects changed values or sources", () => {
    const hash = productionConfigurationFingerprint(published);
    expect(() => assertPreviewConfiguration(published, hash)).not.toThrow();
    expect(() =>
      assertPreviewConfiguration(
        { ...published, sound: { ...published.sound, dialogue: true } },
        hash,
      ),
    ).toThrow("重新预览");
    expect(() =>
      assertPreviewConfiguration(
        { ...published, sources: [{ scopeKey: "panel:p", version: 3 }] },
        hash,
      ),
    ).toThrow("重新预览");
  });
  it("rejects malformed preview hashes while keeping existing API clients compatible", () => {
    expect(() => assertPreviewConfiguration(published)).not.toThrow();
    expect(() => assertPreviewConfiguration(published, "fake")).toThrow("无效");
    expect(
      productionRequestOptionsSchema.safeParse({
        previewConfigurationHash: "fake",
      }).success,
    ).toBe(false);
  });
});
