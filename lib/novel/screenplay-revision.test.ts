import { beforeEach, describe, expect, it, vi } from "vitest";

const requestOpenAiStructured = vi.hoisted(() => vi.fn());
const storyClipFindFirst = vi.hoisted(() => vi.fn());
const channelFindFirst = vi.hoisted(() => vi.fn());
const providerModelFindFirst = vi.hoisted(() => vi.fn());
const deliverableAggregate = vi.hoisted(() => vi.fn());
const deliverableCreate = vi.hoisted(() => vi.fn());
const storyClipUpdate = vi.hoisted(() => vi.fn());
const storyboardUpdateMany = vi.hoisted(() => vi.fn());
const storyboardPanelUpdateMany = vi.hoisted(() => vi.fn());
const voiceLineUpdateMany = vi.hoisted(() => vi.fn());
const editorProjectUpdateMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/llm/openai-structured", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm/openai-structured")>()),
  requestOpenAiStructured,
}));
vi.mock("@/lib/production/domain-store", () => ({
  listProductionProps: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/production/world-bible", () => ({
  loadApprovedWorldBible: vi.fn().mockResolvedValue({ payload: {} }),
}));
vi.mock("./domain-store", () => ({
  listNovelCharacters: vi.fn().mockResolvedValue([{ name: "甲" }]),
  listNovelLocations: vi.fn().mockResolvedValue([{ name: "书房" }]),
}));
vi.mock("@/lib/server/crypto", () => ({
  decryptSecret: (value: string) => value,
}));
vi.mock("@/lib/settings/runtime-store", () => ({
  loadUserRuntimeSettings: vi.fn().mockResolvedValue({
    screenplayClipMaxChars: 1_600,
    structuredOutputStreaming: true,
    structuredRequestTimeoutSeconds: 600,
    structuredTransportMaxAttempts: 3,
    workflowConcurrency: 2,
    workflowStepMaxAttempts: 3,
  }),
}));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    channel: { findFirst: channelFindFirst },
    providerModel: { findFirst: providerModelFindFirst },
    storyClip: { findFirst: storyClipFindFirst },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        editorProject: { updateMany: editorProjectUpdateMany },
        productionDeliverable: {
          aggregate: deliverableAggregate,
          create: deliverableCreate,
        },
        storyboard: { updateMany: storyboardUpdateMany },
        storyboardPanel: { updateMany: storyboardPanelUpdateMany },
        storyClip: { update: storyClipUpdate },
        voiceLine: { updateMany: voiceLineUpdateMany },
      }),
  },
}));

import { buildSourceEvents } from "@/lib/prompts/validators";
import {
  canReviseScreenplayClip,
  classifyScreenplayFailureContext,
  reviseScreenplayClip,
} from "./screenplay-revision";

const source = "甲走进书房。";
const screenplay = {
  clipId: "clip-1",
  originalText: source,
  coverage: buildSourceEvents(source).map((event) => ({
    eventId: event.eventId,
    evidence: event.evidence,
    modes: ["visual" as const],
    reason: null,
  })),
  scenes: [
    {
      sceneNumber: 0,
      heading: { intExt: "INT" as const, location: "书房", time: "日" },
      description: "",
      characters: ["甲"],
      content: [{ type: "action" as const, text: source }],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  storyClipFindFirst.mockResolvedValue({
    id: "clip-1",
    episodeId: "episode-1",
    clipIndex: 0,
    content: source,
    screenplay: JSON.stringify(screenplay),
  });
  channelFindFirst.mockResolvedValue({
    baseUrl: "https://provider.test/v1",
    encryptedApiKeys: '["key-1"]',
    protocol: "openai-compatible",
  });
  providerModelFindFirst.mockResolvedValue({ capabilitiesJson: "{}" });
  deliverableAggregate.mockResolvedValue({ _max: { version: 2 } });
  requestOpenAiStructured.mockResolvedValue({
    data: screenplay,
    trace: { promptId: "story_screenplay_revision" },
  });
});

describe("screenplay revision", () => {
  it("separates semantic repair from transport retry", () => {
    const semantic = {
      error: "STRUCTURED_SEMANTIC_INVALID:coverage:[SOURCE_EVENT_MISSING]",
    };
    const transport = {
      code: "PROVIDER_TRANSPORT_ERROR",
      error: "STRUCTURED_PROVIDER_TRANSPORT_FAILED:UND_ERR_SOCKET",
    };

    expect(classifyScreenplayFailureContext(semantic)).toBe("semantic");
    expect(classifyScreenplayFailureContext(transport)).toBe("transport");
    expect(
      canReviseScreenplayClip({ screenplay: null, failureContext: semantic }),
    ).toBe(true);
    expect(
      canReviseScreenplayClip({ screenplay: null, failureContext: transport }),
    ).toBe(false);
  });

  it("stores a revision and marks every downstream episode output stale", async () => {
    const result = await reviseScreenplayClip({
      channelId: "channel-1",
      clipId: "clip-1",
      locale: "zh",
      model: "model-1",
      projectId: "project-1",
      request: "加强有原文证据的表演反应",
      userId: "user-1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        clipId: "clip-1",
        downstreamStatus: "stale",
        sceneCount: 1,
      }),
    );
    expect(requestOpenAiStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "model-1",
        prompt: expect.objectContaining({
          text: expect.stringContaining(source),
        }),
        timeoutMs: 600_000,
      }),
    );
    expect(deliverableCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliverableType: "screenplay_revision",
          version: 3,
        }),
      }),
    );
    expect(storyClipUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "screenplay_revised" }),
      }),
    );
    for (const update of [
      storyboardUpdateMany,
      storyboardPanelUpdateMany,
      voiceLineUpdateMany,
    ])
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "stale" } }),
      );
    expect(editorProjectUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { renderStatus: "stale" } }),
    );
  });

  it("regenerates a failed clip from semantic error details", async () => {
    storyClipFindFirst.mockResolvedValue({
      id: "clip-1",
      episodeId: "episode-1",
      clipIndex: 0,
      content: source,
      screenplay: null,
    });

    await expect(
      reviseScreenplayClip({
        channelId: "channel-1",
        clipId: "clip-1",
        failureContext: {
          error: "STRUCTURED_SCHEMA_INVALID:scenes.0.content",
        },
        locale: "zh",
        model: "model-1",
        projectId: "project-1",
        request: "根据校验错误修复剧本",
        userId: "user-1",
      }),
    ).resolves.toEqual(expect.objectContaining({ clipId: "clip-1" }));
    expect(requestOpenAiStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.objectContaining({
          text: expect.stringContaining("当前剧本：null"),
        }),
      }),
    );
  });

  it("refuses to rewrite content for a transport failure", async () => {
    await expect(
      reviseScreenplayClip({
        channelId: "channel-1",
        clipId: "clip-1",
        failureContext: {
          error: "STRUCTURED_PROVIDER_TRANSPORT_FAILED:UND_ERR_SOCKET",
        },
        locale: "zh",
        model: "model-1",
        projectId: "project-1",
        request: "根据报错调整",
        userId: "user-1",
      }),
    ).rejects.toThrow("SCREENPLAY_REVISION_TRANSPORT_RETRY_REQUIRED");
    expect(requestOpenAiStructured).not.toHaveBeenCalled();
  });
});
