import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mergeProductionConfigurations } from "@/lib/production-configuration/contract";
import { getConfigurationAgentCatalog } from "@/lib/production-configuration/agents";
import { productionCopy } from "./copy";
import { SoundEditor } from "./sound-editor";
import { AgentEditor } from "./agent-editor";

describe("simplified management editors", () => {
  it.each(["zh-CN", "en"] as const)(
    "limits %s sound management to three production modes",
    (locale) => {
      const copy = productionCopy[locale];
      const html = renderToStaticMarkup(
        createElement(SoundEditor, {
          sound: mergeProductionConfigurations([]).sound,
          patch: {},
          onChange: () => {},
          source: () => copy.default,
          copy,
        }),
      );
      expect(html.match(/role="radio"/g)).toHaveLength(3);
      expect(html).toContain(copy.native);
      expect(html).toContain(
        renderToStaticMarkup(createElement("span", null, copy.post)).replace(
          /^<span>|<\/span>$/g,
          "",
        ),
      );
      expect(html).toContain(copy.silent);
      expect(html).not.toContain('role="checkbox"');
      expect(html).not.toContain("<textarea");
      expect(html).not.toContain(
        locale === "en" ? "Voice profiles" : "角色声音设定",
      );
      expect(html).not.toContain(locale === "en" ? "Add speech" : "添加台词");
    },
  );

  it("renders a compact Agent navigation while retaining editable responsibilities", () => {
    const copy = productionCopy["zh-CN"];
    const catalog = getConfigurationAgentCatalog();
    const other = catalog.find((item) => item.id === "source_notes")!;
    const html = renderToStaticMarkup(
      createElement(AgentEditor, {
        catalog,
        agents: {
          studio_workflow_agent: {
            name: "创作助手",
            responsibility: "按项目规范工作",
          },
        },
        patch: {
          studio_workflow_agent: {
            name: "创作助手",
            responsibility: "按项目规范工作",
          },
        },
        onChange: () => {},
        models: [],
        source: () => copy.default,
        copy,
      }),
    );
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("创作助手");
    expect(html).toContain("原著资料整理");
    expect(html).toContain("按项目规范工作");
    expect(html).not.toContain(other.responsibility);
    expect(html).toContain(`aria-label="${copy.agentSearch}"`);
    expect(html).toContain(copy.agentPromptTab);
    expect(html).toContain(copy.agentRuntimeTab);
  });
});
