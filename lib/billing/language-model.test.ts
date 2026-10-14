import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ reserve: vi.fn(), settle: vi.fn() }));
vi.mock("./model-charge", () => ({ reserveModelRequestCharge: mocks.reserve, settleModelRequestCharge: mocks.settle }));
import { billedLanguageModel, languageModelInputCharacters } from "./language-model";

function model(parts: Array<{ type: string; [key: string]: unknown }> = [{ type: "finish", finishReason: { unified: "stop" } }]) {
  return billedLanguageModel({ specificationVersion: "v4", provider: "fixture", modelId: "fixture-model", supportedUrls: {},
    doGenerate: async () => ({ content: [{ type: "text", text: "response" }], finishReason: { unified: "stop" }, usage: {}, warnings: [] }),
    doStream: async () => ({ stream: new ReadableStream({ start(controller) { parts.forEach(part => controller.enqueue(part)); controller.close(); } }) }),
  } as unknown as Parameters<typeof billedLanguageModel>[0], { userId: "u", provider: "fixture" }, "fixture-model");
}
const params = { prompt: [{ role: "system" as const, content: "system" }, { role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reserve.mockResolvedValue({ id: "f", userId: "u" });
  mocks.settle.mockResolvedValue({ id: "c", amount: "0.03" });
});

describe("AI SDK wallet middleware", () => {
  it("counts textual request content and bills every generate call", async () => {
    expect(languageModelInputCharacters(params)).toBe(11);
    const wrapped = model();
    await wrapped.doGenerate(params);
    await wrapped.doGenerate(params);
    expect(mocks.reserve).toHaveBeenCalledTimes(2);
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({ usage: { requests: 1, inputCharacters: 11 } }));
    expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), true);
  });
  it("settles only once on stream finish", async () => {
    const result = await model().doStream(params);
    const reader = result.stream.getReader();
    while (!(await reader.read()).done) { /* consume */ }
    expect(mocks.settle).toHaveBeenCalledTimes(1);
    expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), true);
  });
  it("releases canceled streams and provider error events", async () => {
    const result = await model([{ type: "text-delta", id: "t", delta: "hello" }]).doStream(params);
    await result.stream.cancel();
    expect(mocks.settle).toHaveBeenLastCalledWith(expect.anything(), false);
    mocks.settle.mockClear();
    const failed = await model([{ type: "error", error: "failure" }, { type: "finish", finishReason: { unified: "stop" } }]).doStream(params);
    const reader = failed.stream.getReader();
    while (!(await reader.read()).done) { /* consume */ }
    expect(mocks.settle).toHaveBeenCalledTimes(1);
    expect(mocks.settle).toHaveBeenLastCalledWith(expect.anything(), false);
  });
  it("blocks calls when reservation fails", async () => {
    mocks.reserve.mockRejectedValue(new Error("insufficient balance"));
    await expect(model().doGenerate(params)).rejects.toThrow("insufficient balance");
    expect(mocks.settle).not.toHaveBeenCalled();
  });
});
