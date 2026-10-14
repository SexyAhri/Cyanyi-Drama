import { describe, expect, it, vi } from "vitest";
import { productionCopy } from "./copy";
import { confirmConfigurationDiscard } from "./confirmation";

describe("configuration discard confirmation", () => {
  it("blocks navigation during an operation without opening a discard dialog", async () => {
    const confirm = vi.fn();
    expect(await confirmConfigurationDiscard({ dirty: true, busy: true }, confirm, productionCopy["zh-CN"])).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("allows leaving a saved draft without a confirmation", async () => {
    const confirm = vi.fn();
    expect(await confirmConfigurationDiscard({ dirty: false, busy: false }, confirm, productionCopy.en)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each(["zh-CN", "en"] as const)("uses explicit safe and destructive actions in %s", async (locale) => {
    const confirm = vi.fn().mockResolvedValue(false);
    const copy = productionCopy[locale];
    expect(await confirmConfigurationDiscard({ dirty: true, busy: false }, confirm, copy)).toBe(false);
    expect(confirm).toHaveBeenCalledWith({
      title: copy.discardTitle, description: copy.discard,
      confirmLabel: copy.discardChanges, cancelLabel: copy.keepEditing,
      destructive: true,
    });
  });

  it.each([true, false])("waits for an explicit %s decision before returning", async (confirmed) => {
    let resolve!: (result: boolean) => void;
    const confirm = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    let settled = false;
    const result = confirmConfigurationDiscard({ dirty: true, busy: false }, confirm, productionCopy["zh-CN"]);
    void result.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolve(confirmed);
    expect(await result).toBe(confirmed);
  });

  it("keeps the conflict replacement description and action specific", async () => {
    const copy = productionCopy["zh-CN"];
    const confirm = vi.fn().mockResolvedValue(true);
    await confirmConfigurationDiscard({ dirty: true, busy: false }, confirm, copy, {
      description: copy.conflictDiscard, confirmLabel: copy.conflictUseRemote,
    });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ description: copy.conflictDiscard, confirmLabel: copy.conflictUseRemote, cancelLabel: copy.keepEditing }));
  });
});
