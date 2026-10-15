import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import type { ModelBillingIdentity } from "./context";
import { reserveModelRequestCharge, settleModelRequestCharge } from "./model-charge";
import { inputCharacterCount, sdkTokenUsage } from "./usage";

type GenerateParams = Parameters<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>[0]["params"];

/** Count textual request content, including tool definitions/results, excluding binary attachments. */
export function languageModelInputCharacters(params: Pick<GenerateParams, "prompt" | "tools">): number {
  const text = (value: unknown): number => {
    if (typeof value === "string") return inputCharacterCount(value);
    if (Array.isArray(value)) return value.reduce((sum, part) => sum + text(part), 0);
    if (!value || typeof value !== "object") return 0;
    const part = value as Record<string, unknown>;
    if (part.type === "image" || part.type === "file") return 0;
    return Object.entries(part).reduce((sum, [key, item]) =>
      sum + (["type", "role", "providerOptions"].includes(key) ? 0 : text(item)), 0);
  };
  return text(params.prompt) + text(params.tools);
}

export function billedLanguageModel(model: Exclude<LanguageModel, string>, identity: ModelBillingIdentity, modelId: string) {
  const reserve = (params: GenerateParams) => reserveModelRequestCharge({
    identity, model: modelId, capability: "text", action: "chat_completion",
    usage: { requests: 1, inputCharacters: languageModelInputCharacters(params) },
    estimatedOutputTokens: params.maxOutputTokens,
  });
  return wrapLanguageModel({ model, middleware: {
    specificationVersion: "v4",
    async wrapGenerate({ doGenerate, params }) {
      const charge = await reserve(params);
      let result;
      try { result = await doGenerate(); }
      catch (error) { await settleModelRequestCharge(charge, false); throw error; }
      await settleModelRequestCharge(charge, result.finishReason.unified !== "error", sdkTokenUsage(result.usage));
      return result;
    },
    async wrapStream({ doStream, params }) {
      const charge = await reserve(params);
      let result;
      try { result = await doStream(); }
      catch (error) { await settleModelRequestCharge(charge, false); throw error; }
      const reader = result.stream.getReader();
      let settlement: ReturnType<typeof settleModelRequestCharge> | undefined;
      const settle = (success: boolean, usage?: unknown) => settlement ??= success ? settleModelRequestCharge(charge, true, sdkTokenUsage(usage)) : settleModelRequestCharge(charge, false);
      let failed = false;
      const abort = () => { void settle(false).catch(error => console.error("Stream billing release failed", error)); };
      params.abortSignal?.addEventListener("abort", abort, { once: true });
      if (params.abortSignal?.aborted) abort();
      const cleanup = () => params.abortSignal?.removeEventListener("abort", abort);
      return { ...result, stream: new ReadableStream({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) { await settle(false); cleanup(); controller.close(); return; }
            if (next.value.type === "error") { failed = true; await settle(false); }
            if (next.value.type === "finish") {
              await settle(!failed && next.value.finishReason.unified !== "error", next.value.usage); cleanup();
            }
            controller.enqueue(next.value);
          } catch (error) {
            // A failed settlement remains recoverable in the ledger; still terminate the stream.
            try { await settle(false); } catch { /* Keep the original provider/billing error. */ }
            cleanup(); controller.error(error);
          }
        },
        async cancel(reason) {
          cleanup();
          try { await reader.cancel(reason); } finally { await settle(false); }
        },
      }) };
    },
  } });
}
