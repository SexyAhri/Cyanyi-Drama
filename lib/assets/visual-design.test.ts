import { beforeEach, describe, expect, it, vi } from "vitest";

const requestOpenAiText = vi.hoisted(() => vi.fn());
const projectFindFirst = vi.hoisted(() => vi.fn());
const characterFindFirst = vi.hoisted(() => vi.fn());
const characterUpdateMany = vi.hoisted(() => vi.fn());
const channelFindFirst = vi.hoisted(() => vi.fn());
const providerModelFindFirst = vi.hoisted(() => vi.fn());
const episodeFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/llm/openai-structured", () => ({ requestOpenAiText }));
vi.mock("@/lib/server/crypto", () => ({
  decryptSecret: () => '["test-key"]',
}));
vi.mock("@/lib/settings/runtime-store", () => ({
  loadUserRuntimeSettings: vi.fn().mockResolvedValue({
    structuredRequestTimeoutSeconds: 600,
    structuredOutputStreaming: true,
    structuredTransportMaxAttempts: 3,
    workflowStepMaxAttempts: 3,
    workflowConcurrency: 2,
    screenplayClipMaxChars: 1_600,
  }),
}));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    project: { findFirst: projectFindFirst },
    novelCharacter: {
      findFirst: characterFindFirst,
      updateMany: characterUpdateMany,
    },
    novelLocation: { findFirst: vi.fn(), updateMany: vi.fn() },
    novelProp: { findFirst: vi.fn(), updateMany: vi.fn() },
    channel: { findFirst: channelFindFirst },
    providerModel: { findFirst: providerModelFindFirst },
    episode: { findMany: episodeFindMany },
  },
}));

import {
  generateProjectAssetVisualProfile,
  parseAssetVisualDesignText,
  saveProjectAssetVisualProfile,
} from "./visual-design";

const spec = {
  visualIdentity: "A restrained swordsman with a silver hair clasp",
  shapeAndStructure: "Tall, lean build and angular face",
  surfaceAndStyling: "Layered black silk robes with matte leather guards",
  colorPalette: "Black, cool gray, and a restrained silver accent",
  lightingAndPresentation: "Neutral studio background with soft three-point light",
  signatureDetails: ["Silver crescent hair clasp"],
  consistencyRules: ["Keep the angular face and silver hair clasp"],
  negativePrompt: "no modern clothing, no armor color drift",
  inferenceNotes: ["Hair clasp and robe materials are inferred visual choices"],
};

beforeEach(() => {
  vi.clearAllMocks();
  projectFindFirst.mockResolvedValue({
    name: "玄天战尊",
    description: null,
    config: {
      artStyle: "ink animation",
      globalAssetText: null,
      visualEra: "source",
      visualEraCustom: null,
    },
    manuscripts: [
      {
        title: "玄天战尊",
        synopsis: "大秦王朝的少年凭借秘籍修炼，逐步突破淬体境界。",
      },
    ],
  });
  characterFindFirst.mockResolvedValue({
    name: "Lin",
    aliases: '["Master Lin"]',
    introduction: "A disciplined sect leader",
    profileJson: '{"realm":"Core Formation","techniques":["Moon Cut"]}',
  });
  channelFindFirst.mockResolvedValue({
    baseUrl: "https://provider.test/v1",
    protocol: "openai-compatible",
    encryptedApiKeys: "encrypted",
  });
  providerModelFindFirst.mockResolvedValue({
    capabilitiesJson: JSON.stringify({ supportsStructuredOutputs: true }),
  });
  episodeFindMany.mockResolvedValue([
    {
      description: "韩子枫将古籍交给儿子。",
      novelText: "韩子枫曾是韩家庄的天才，如今身受重伤。",
      sourceVersions: [],
    },
  ]);
  requestOpenAiText.mockResolvedValue({
    text: JSON.stringify(spec),
    outputText: JSON.stringify(spec),
    trace: { promptId: "asset_visual_design", version: 1 },
  });
});

describe("asset visual design", () => {
  it("designs from story facts and persists model provenance", async () => {
    const result = await generateProjectAssetVisualProfile({
      userId: "user-1",
      projectId: "project-1",
      targetType: "character",
      targetId: "character-1",
      channelId: "channel-1",
      model: "analysis-model",
      locale: "zh",
    });

    const request = requestOpenAiText.mock.calls[0][0];
    expect(request.prompt.text).toContain('"realm": "Core Formation"');
    expect(request.prompt.text).toContain("ink animation");
    expect(request.prompt.text).toContain("最高优先级");
    expect(request.prompt.text).toContain("古代东方修炼世界");
    expect(request.prompt.text).toContain("画风与视觉改编世界是两套独立约束");
    expect(request.prompt.text).toContain("本资产制作字段要求");
    expect(request.prompt.text).toContain("韩子枫曾是韩家庄的天才");
    expect(result.profile).toMatchObject({
      source: "model",
      model: "analysis-model",
      spec,
      promptTrace: { rawOutput: JSON.stringify(spec) },
    });
    const stored = JSON.parse(
      characterUpdateMany.mock.calls[0][0].data.visualProfileJson,
    );
    expect(stored).toMatchObject({
      source: "model",
      projectArtStyle: "ink animation",
      storyWorld: {
        setting: "premodern_cultivation",
      },
      spec,
    });
  });

  it("keeps story-world guidance advisory and persists the model result", async () => {
    const modernSpec = {
      ...spec,
      shapeAndStructure: "Middle-aged man with a modern crew cut",
      surfaceAndStyling: "White dress shirt, business suit, and slacks",
    };
    requestOpenAiText.mockResolvedValueOnce({
      text: JSON.stringify(modernSpec),
      outputText: JSON.stringify(modernSpec),
      trace: {
        promptId: "asset_visual_design",
        version: 2,
        correctionAttempts: 0,
      },
    });

    const result = await generateProjectAssetVisualProfile({
      userId: "user-1",
      projectId: "project-1",
      targetType: "character",
      targetId: "character-1",
      channelId: "channel-1",
      model: "analysis-model",
      locale: "zh",
    });

    expect(result.profile).toMatchObject({
      spec: modernSpec,
      promptTrace: {
        correctionAttempts: 0,
        rawOutput: JSON.stringify(modernSpec),
      },
    });
    expect(characterUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("records manual revisions separately", async () => {
    const result = await saveProjectAssetVisualProfile({
      userId: "user-1",
      projectId: "project-1",
      targetType: "character",
      targetId: "character-1",
      spec,
    });

    expect(result).toMatchObject({
      source: "manual",
      projectArtStyle: "ink animation",
      spec,
    });
    expect(requestOpenAiText).not.toHaveBeenCalled();
  });

  it("allows a human revision that differs from local story-world heuristics", async () => {
    const manualSpec = {
      ...spec,
      shapeAndStructure: "Middle-aged man with a modern crew cut",
      surfaceAndStyling: "White dress shirt and business suit",
    };
    const result = await saveProjectAssetVisualProfile({
      userId: "user-1",
      projectId: "project-1",
      targetType: "character",
      targetId: "character-1",
      spec: manualSpec,
    });

    expect(result.spec).toEqual(manualSpec);
    expect(requestOpenAiText).not.toHaveBeenCalled();
    expect(characterUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("places labeled prose without requiring every field", () => {
    expect(
      parseAssetVisualDesignText(
        "视觉身份：病弱而温和的中年男子\n一致性规则：保持剑眉与苍白脸色\n推断记录：衣袍颜色为视觉推断",
      ),
    ).toMatchObject({
      visualIdentity: "病弱而温和的中年男子",
      consistencyRules: ["保持剑眉与苍白脸色"],
      inferenceNotes: ["衣袍颜色为视觉推断"],
      signatureDetails: [],
    });
  });

  it("keeps unformatted model prose as usable visual identity", () => {
    expect(parseAssetVisualDesignText("病弱、温和，穿深灰旧袍。")).toMatchObject({
      visualIdentity: "病弱、温和，穿深灰旧袍。",
      consistencyRules: [],
    });
  });
});
