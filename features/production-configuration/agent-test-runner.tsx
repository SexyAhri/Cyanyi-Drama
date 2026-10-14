"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  ConfigurationScope,
  ProductionConfiguration,
} from "@/lib/production-configuration/contract";
import type { ProductionCopy } from "./copy";

type PreviewResult = {
  response: string;
  proposedOperation: string | null;
  targetId: string | null;
  modelSelection?: { channelId: string; model: string };
  testRun: null | {
    request: {
      channelId?: string;
      model: string;
      structuredOutputMode?: string;
      temperature: number;
      systemText: string;
      userText: string;
    };
    trace: {
      model: string;
      channelId?: string;
      tokenUsage: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      } | null;
      correctionAttempts: number;
      outputHash: string;
    };
    validation: {
      passed: boolean;
      schema: string;
      code?: string;
      fallback?: "plain_text";
    };
    costEstimate: AgentTestCostEstimate | null;
  };
  failure?: {
    id: string;
    trace: {
      model: string;
      channelId?: string;
      tokenUsage: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      } | null;
      correctionAttempts: number;
      outputHash?: string;
    };
    validation: { passed: false; schema: string; code: string };
    costEstimate: AgentTestCostEstimate;
    configurationSources: Array<{ scopeKey: string; version: number }>;
  };
  configurationSources: Array<{ scopeKey: string; version: number }>;
  executed: false;
};
type CostUnknownReason =
  | "channel_unavailable"
  | "usage_unavailable"
  | "price_unavailable"
  | "price_unsupported"
  | "record_failed";
type AgentTestCostEstimate =
  | {
      charged: true;
      estimated: false;
      id: string;
      amount: string;
      quantity: number;
      unit: string;
    }
  | {
      charged?: false;
      estimated: true;
      id: string;
      amount: string;
      quantity: number;
      unit: string;
    }
  | { charged?: false; estimated: false; reason: CostUnknownReason };

export function AgentTestRunResult({
  result,
  copy,
}: {
  result: PreviewResult;
  copy: ProductionCopy;
}) {
  function unknownCostReason(reason: CostUnknownReason) {
    switch (reason) {
      case "channel_unavailable":
        return copy.testRunCostUnknownChannel;
      case "usage_unavailable":
        return copy.testRunCostUnknownUsage;
      case "price_unavailable":
        return copy.testRunCostUnknownPrice;
      case "price_unsupported":
        return copy.testRunCostUnknownUnsupported;
      case "record_failed":
        return copy.testRunCostUnknownRecord;
      default:
        return copy.testRunCostUnknown;
    }
  }

  function costText(cost: AgentTestCostEstimate | null | undefined) {
    if (!cost || !("amount" in cost))
      return unknownCostReason(cost?.reason ?? "usage_unavailable");
    const units: Record<string, string> =
      copy.testRunCostCharged === "已扣余额"
        ? {
            request: "次",
            character: "字符",
            "1k_character": "千字符",
            mixed: "笔",
            tokens: "令牌",
          }
        : {
            request: "requests",
            character: "characters",
            "1k_character": "thousand characters",
            mixed: "entries",
            tokens: "tokens",
          };
    const label = cost.charged
      ? copy.testRunCostCharged
      : copy.testRunCostEstimated;
    return `${cost.amount} · ${cost.quantity} ${units[cost.unit] ?? cost.unit} · ${label} (${cost.id})`;
  }
  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-sm font-medium">{copy.testRunResponse}</p>
      {result.response ? (
        <p className="whitespace-pre-wrap text-sm">{result.response}</p>
      ) : null}
      {result.proposedOperation && (
        <p className="break-anywhere text-xs text-muted-foreground">
          {copy.testRunProposal}: {result.proposedOperation} ·{" "}
          {result.targetId ?? "—"}
        </p>
      )}
      {result.failure ? (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3"
          role="status"
        >
          <p className="text-sm font-medium text-destructive">
            {copy.testRunRejected} · {result.failure.validation.code}
          </p>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{copy.model}</dt>
              <dd className="break-all">
                {result.failure.trace.model} ·{" "}
                {result.failure.trace.channelId ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {copy.testRunValidation}
              </dt>
              <dd>{result.failure.validation.schema}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.testRunTokens}</dt>
              <dd>
                {result.failure.trace.tokenUsage
                  ? `${result.failure.trace.tokenUsage.inputTokens ?? "?"} / ${result.failure.trace.tokenUsage.outputTokens ?? "?"} / ${result.failure.trace.tokenUsage.totalTokens ?? "?"}`
                  : copy.unknown}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.testRunCost}</dt>
              <dd className="break-anywhere">
                {costText(result.failure.costEstimate)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {copy.testRunCorrectionAttempts}
              </dt>
              <dd>{result.failure.trace.correctionAttempts}</dd>
            </div>
            {result.failure.trace.outputHash ? (
              <div className="min-w-0">
                <dt className="text-muted-foreground">
                  {copy.testRunOutputHash}
                </dt>
                <dd className="break-all font-mono">
                  {result.failure.trace.outputHash}
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-3 break-all text-xs text-muted-foreground">
            {copy.configurationSources}:{" "}
            {result.failure.configurationSources
              .map((source) => `${source.scopeKey} v${source.version}`)
              .join(" · ") || copy.default}
          </p>
        </div>
      ) : result.testRun ? (
        <>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{copy.model}</dt>
              <dd className="break-all">
                {result.testRun.trace.model} ·{" "}
                {result.testRun.trace.channelId ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {copy.testRunValidation}
              </dt>
              <dd>
                {result.testRun.validation.passed
                  ? copy.testRunPassed
                  : `${copy.testRunPlainTextFallback}${result.testRun.validation.code ? ` · ${result.testRun.validation.code}` : ""}`}{" "}
                · {result.testRun.validation.schema}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.testRunTokens}</dt>
              <dd>
                {result.testRun.trace.tokenUsage
                  ? `${result.testRun.trace.tokenUsage.inputTokens ?? "?"} / ${result.testRun.trace.tokenUsage.outputTokens ?? "?"} / ${result.testRun.trace.tokenUsage.totalTokens ?? "?"}`
                  : copy.unknown}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{copy.testRunCost}</dt>
              <dd className="break-anywhere">
                {costText(result.testRun.costEstimate)}
              </dd>
            </div>
          </dl>
          <details className="text-xs">
            <summary className="cursor-pointer">{copy.testRunRequest}</summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-anywhere rounded border bg-background p-3">
              {JSON.stringify(result.testRun.request, null, 2)}
            </pre>
          </details>
          <p className="break-all text-xs text-muted-foreground">
            {copy.configurationSources}:{" "}
            {result.configurationSources
              .map((source) => `${source.scopeKey} v${source.version}`)
              .join(" · ") || copy.default}
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{copy.testRunNoModel}</p>
      )}
    </div>
  );
}

export function AgentTestRunner({
  projectId,
  scope,
  agents,
  copy,
}: {
  projectId: string;
  scope: ConfigurationScope;
  agents: ProductionConfiguration["agents"];
  copy: ProductionCopy;
}) {
  const [content, setContent] = useState(copy.testRunDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PreviewResult | null>(null);

  async function run() {
    if (busy || !content.trim()) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/agent-test-run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            locale: copy.testRunLocale,
            context: {
              view: "workflow",
              stageId: scope.panelId ? "shots" : "writing",
              ...(scope.episodeId ? { episodeId: scope.episodeId } : {}),
              ...(scope.panelId
                ? {
                    selection: {
                      id: scope.panelId,
                      kind: "storyboard_panel",
                      label: copy.testRunSelectedShot,
                    },
                  }
                : {}),
            },
            draft: { agents },
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        if (data.testRunFailure) {
          setResult({
            response: "",
            proposedOperation: null,
            targetId: null,
            testRun: null,
            failure: data.testRunFailure,
            configurationSources:
              data.testRunFailure.configurationSources ?? [],
            executed: false,
          } as PreviewResult);
        }
        throw new Error(data.message ?? copy.testRunFailed);
      }
      setResult(data as PreviewResult);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.testRunFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="space-y-3 rounded-lg border bg-muted/20 p-3"
      aria-labelledby="agent-test-run-title"
    >
      <div>
        <h3 id="agent-test-run-title" className="text-sm font-semibold">
          {copy.testRun}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{copy.testRunHelp}</p>
      </div>
      <Textarea
        aria-label={copy.testRunInput}
        value={content}
        maxLength={4000}
        onChange={(event) => setContent(event.target.value)}
      />
      <Button
        type="button"
        variant="outline"
        className="min-h-10"
        disabled={busy || !content.trim()}
        onClick={() => void run()}
      >
        {busy ? copy.testRunBusy : copy.testRunStart}
      </Button>
      {error && (
        <p role="alert" className="break-anywhere text-sm text-destructive">
          {error}
        </p>
      )}
      {result && <AgentTestRunResult result={result} copy={copy} />}
    </section>
  );
}
