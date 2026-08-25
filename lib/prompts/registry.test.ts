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
    expect(PROMPT_ID_LIST).toHaveLength(9);

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
      expect(zhSecond.versionHash).toBe(zhFirst.versionHash);
      expect(en.templateHash).not.toBe(zhFirst.templateHash);
      expect(en.versionHash).not.toBe(zhFirst.versionHash);
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
