import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentTestRunResult, AgentTestRunner } from "./agent-test-runner";
import { productionCopy } from "./copy";

const scope = {
  projectId: "project-1",
  episodeId: "episode-1",
  panelId: "panel-1",
};
const agents = {} as Parameters<typeof AgentTestRunner>[0]["agents"];

function result(costEstimate: unknown) {
  return {
    response: "Keep the continuity of the scene.",
    proposedOperation: null,
    targetId: null,
    testRun: {
      request: {
        model: "text-model",
        temperature: 0.1,
        systemText: "system",
        userText: "prompt".repeat(500),
      },
      trace: {
        model: "text-model",
        channelId: "channel-1",
        tokenUsage: { inputTokens: 120, outputTokens: 12, totalTokens: 132 },
        correctionAttempts: 0,
        outputHash: "abc",
      },
      validation: {
        passed: true as const,
        schema: "studioWorkflowAgentSchema",
      },
      costEstimate,
    },
    configurationSources: [{ scopeKey: "project:project-1", version: 2 }],
    executed: false as const,
  } as Parameters<typeof AgentTestRunResult>[0]["result"];
}

describe("Agent test-run UI acceptance", () => {
  it.each(["zh-CN", "en"] as const)(
    "renders the %s form with localized labels and native keyboard controls",
    (locale) => {
      const html = renderToStaticMarkup(
        createElement(AgentTestRunner, {
          projectId: "project-1",
          scope,
          agents,
          copy: productionCopy[locale],
        }),
      );
      expect(html).toContain(`aria-labelledby="agent-test-run-title"`);
      expect(html).toContain(
        `aria-label="${productionCopy[locale].testRunInput}"`,
      );
      expect(html).toContain("<textarea");
      expect(html).toContain("<button");
      expect(html).toContain(productionCopy[locale].testRunHelp);
      expect(html).toContain("min-h-10");
      expect(html).toContain("bg-muted/20");
    },
  );

  it("uses responsive layout, theme tokens and bounded keyboard-accessible long-request details", () => {
    const html = renderToStaticMarkup(
      createElement(AgentTestRunResult, {
        result: result({ estimated: false, reason: "price_unavailable" }),
        copy: productionCopy["zh-CN"],
      }),
    );
    expect(html).toContain("grid gap-2 text-xs sm:grid-cols-2");
    expect(html).toContain("text-muted-foreground");
    expect(html).toContain("bg-background");
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain(
      "max-h-96 overflow-auto whitespace-pre-wrap break-anywhere",
    );
    expect(html).toContain(productionCopy["zh-CN"].testRunCostUnknownPrice);
    expect(html).toContain('<dd class="break-anywhere">');
  });

  it("shows a recorded estimate and its ledger id without rendering provider secrets", () => {
    const html = renderToStaticMarkup(
      createElement(AgentTestRunResult, {
        result: result({
          estimated: true,
          id: "usage-cost-1",
          amount: "0.004",
          quantity: 132,
          unit: "tokens",
        }),
        copy: productionCopy.en,
      }),
    );
    expect(html).toContain("0.004");
    expect(html).toContain("usage-cost-1");
    expect(html).toContain("132 tokens");
    expect(html).not.toContain("apiKey");
  });

  it("clearly labels a displayed plain-text reply as structurally unvalidated", () => {
    const html = renderToStaticMarkup(
      createElement(AgentTestRunResult, {
        result: {
          ...result({ estimated: false, reason: "usage_unavailable" }),
          testRun: {
            ...result({ estimated: false, reason: "usage_unavailable" })
              .testRun!,
            validation: {
              passed: false,
              schema: "studioWorkflowAgentSchema",
              code: "STRUCTURED_JSON_INVALID",
              fallback: "plain_text",
            },
          },
        },
        copy: productionCopy["zh-CN"],
      }),
    );
    expect(html).toContain(productionCopy["zh-CN"].testRunPlainTextFallback);
    expect(html).toContain("STRUCTURED_JSON_INVALID");
    expect(html).not.toContain(productionCopy["zh-CN"].testRunPassed);
  });

  it("renders safe failed-attempt validation, usage, pricing and hash details", () => {
    const html = renderToStaticMarkup(
      createElement(AgentTestRunResult, {
        result: {
          response: "",
          proposedOperation: null,
          targetId: null,
          testRun: null,
          failure: {
            id: "failed-test-run-1",
            trace: {
              model: "text-model",
              channelId: "channel-1",
              tokenUsage: { inputTokens: 25, outputTokens: 7, totalTokens: 32 },
              correctionAttempts: 0,
              outputHash: "a".repeat(64),
            },
            validation: {
              passed: false,
              schema: "studioWorkflowAgentSchema",
              code: "STRUCTURED_JSON_INVALID",
            },
            costEstimate: { estimated: false, reason: "price_unavailable" },
            configurationSources: [{ scopeKey: "test-draft", version: 0 }],
          },
          configurationSources: [],
          executed: false,
        },
        copy: productionCopy.en,
      }),
    );
    expect(html).toContain(productionCopy.en.testRunRejected);
    expect(html).toContain("STRUCTURED_JSON_INVALID");
    expect(html).toContain("25 / 7 / 32");
    expect(html).toContain(productionCopy.en.testRunCostUnknownPrice);
    expect(html).toContain("a".repeat(64));
    expect(html).not.toContain("plain text that is not JSON");
  });
});
