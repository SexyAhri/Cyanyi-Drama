import { describe, expect, it } from "vitest";

import { PROMPT_CATALOG } from "./catalog";
import { PROMPT_IDS, type PromptId } from "./ids";
import {
  getPromptTemplate,
  PromptContractError,
  renderPrompt,
} from "./registry";
import type { PromptLocale } from "./types";

const PROMPT_ID_LIST = Object.values(PROMPT_IDS);
const LOCALES: PromptLocale[] = ["zh", "en"];

describe("prompt registry", () => {
  it("provides catalog-aligned Chinese and English templates", () => {
    expect(PROMPT_ID_LIST).toHaveLength(19);

    for (const id of PROMPT_ID_LIST) {
      for (const locale of LOCALES) {
        const template = getPromptTemplate(id, locale);
        const placeholders = Array.from(
          template.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g),
          (match) => match[1],
        ).sort();

        expect(template.length).toBeGreaterThan(0);
        expect(placeholders).toEqual([...PROMPT_CATALOG[id].variables].sort());
      }
    }
  });

  it("rejects missing variables consistently across repeated renders", () => {
    const id = PROMPT_IDS.STORY_CHARACTER_ANALYSIS;
    const variables = variablesFor(id);
    delete variables.source_text;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(() => renderPrompt({ id, variables })).toThrowError(
        contractError("PROMPT_VARIABLE_MISSING", id, "source_text"),
      );
    }
  });

  it("rejects unexpected variables", () => {
    const id = PROMPT_IDS.STORY_CHARACTER_ANALYSIS;

    expect(() =>
      renderPrompt({
        id,
        variables: { ...variablesFor(id), extra: "not declared" },
      }),
    ).toThrowError(contractError("PROMPT_VARIABLE_UNEXPECTED", id, "extra"));
  });

  it("preserves placeholder-shaped text inside variable values", () => {
    const id = PROMPT_IDS.STORY_CHARACTER_ANALYSIS;
    const rendered = renderPrompt({
      id,
      variables: {
        source_text: "Keep {{character_library}} as source text",
        character_library: "[]",
      },
    });

    expect(rendered.text).toContain("Keep {{character_library}} as source text");
  });

  it("produces stable locale-specific hashes", () => {
    for (const id of PROMPT_ID_LIST) {
      const variables = variablesFor(id);
      const zhFirst = renderPrompt({ id, locale: "zh", variables });
      const zhSecond = renderPrompt({ id, locale: "zh", variables });
      const en = renderPrompt({ id, locale: "en", variables });

      expect(zhSecond.templateHash).toBe(zhFirst.templateHash);
      expect(zhSecond.systemHash).toBe(zhFirst.systemHash);
      expect(zhSecond.versionHash).toBe(zhFirst.versionHash);
      expect(en.templateHash).not.toBe(zhFirst.templateHash);
      expect(en.systemHash).not.toBe(zhFirst.systemHash);
      expect(en.versionHash).not.toBe(zhFirst.versionHash);
    }
  });

  it("renders complete runtime agent contracts into system messages", () => {
    for (const id of PROMPT_ID_LIST) {
      const entry = PROMPT_CATALOG[id];
      const rendered = renderPrompt({ id, variables: variablesFor(id) });

      expect(entry.agent.successCriteria.length).toBeGreaterThan(0);
      expect(entry.agent.qualityGates.length).toBeGreaterThan(0);
      expect(entry.version).toBe(expectedVersion(id));
      expect(entry.agent.contextPolicy.trust).toBe("untrusted");
      expect(entry.agent.retryPolicy).toEqual({
        maxSemanticCorrections: 1,
        mode: "targeted",
      });
      expect(rendered.agentId).toBe(entry.agent.id);
      expect(rendered.maxSemanticCorrections).toBe(
        entry.agent.retryPolicy.maxSemanticCorrections,
      );
      expect(rendered.systemText).toContain(entry.agent.id);
      expect(rendered.systemText).toContain("不可信数据");
      expect(rendered.systemText).toContain(
        `scope=${entry.agent.contextPolicy.scope}`,
      );
      expect(rendered.systemText).toContain("允许工具");
    }
  });

  it("uses input references for agents without direct source text", () => {
    for (const id of [
      PROMPT_IDS.STORY_CINEMATOGRAPHY,
      PROMPT_IDS.STORY_ACTING_DIRECTION,
    ]) {
      expect(PROMPT_CATALOG[id].agent.evidencePolicy).toEqual({
        required: true,
        mode: "input_references",
      });
      expect(PROMPT_CATALOG[id].agent.qualityGates).toContain(
        "input_references_valid",
      );
    }
  });
});

function variablesFor(id: PromptId) {
  return Object.fromEntries(
    PROMPT_CATALOG[id].variables.map((variable) => [variable, variable]),
  );
}

function contractError(code: string, id: PromptId, detail: string) {
  return new PromptContractError(code, id, detail);
}

function expectedVersion(id: PromptId) {
  const versions: Record<PromptId, number> = {
    [PROMPT_IDS.STORY_CHARACTER_ANALYSIS]: 3,
    [PROMPT_IDS.STORY_LOCATION_PROP_ANALYSIS]: 5,
    [PROMPT_IDS.STORY_CLIP_SEGMENTATION]: 4,
    [PROMPT_IDS.STORY_SCREENPLAY_CONVERSION]: 13,
    [PROMPT_IDS.STORY_STORYBOARD_PLANNING]: 11,
    [PROMPT_IDS.STORY_CINEMATOGRAPHY]: 7,
    [PROMPT_IDS.STORY_ACTING_DIRECTION]: 8,
    [PROMPT_IDS.STORY_STORYBOARD_REFINEMENT]: 9,
    [PROMPT_IDS.STORY_VOICE_ANALYSIS]: 7,
    [PROMPT_IDS.STORY_VOICE_PERFORMANCE_DESIGN]: 2,
    [PROMPT_IDS.STORY_CONTINUITY_REVIEW]: 5,
    [PROMPT_IDS.ASSET_VISUAL_EXTRACTION]: 1,
    [PROMPT_IDS.CHARACTER_REFERENCE_DESCRIPTION]: 1,
    [PROMPT_IDS.EPISODE_SPLIT]: 1,
    [PROMPT_IDS.EPISODE_ADAPTATION]: 6,
    [PROMPT_IDS.ASSET_VISUAL_DESIGN]: 4,
    [PROMPT_IDS.STORYBOARD_MEDIA_PROMPT_DESIGN]: 1,
    [PROMPT_IDS.STORY_SCREENPLAY_REVISION]: 4,
    [PROMPT_IDS.STUDIO_WORKFLOW_AGENT]: 1,
  };
  return versions[id];
}
