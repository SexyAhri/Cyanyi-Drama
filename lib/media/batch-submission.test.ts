import { describe, expect, it, vi } from "vitest";

import { submitBatchItems } from "./batch-submission";

describe("submitBatchItems", () => {
  it("continues after an item fails and preserves every outcome", async () => {
    const submit = vi.fn(async (item: number) => {
      if (item === 2) throw new Error("panel is no longer available");
      return `task-${item}`;
    });

    const result = await submitBatchItems([1, 2, 3], submit);

    expect(submit).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      results: [
        { item: 1, value: "task-1" },
        { item: 3, value: "task-3" },
      ],
      failures: [
        { item: 2, message: "panel is no longer available" },
      ],
      summary: { requested: 3, submitted: 2, failedToSubmit: 1 },
    });
  });

  it("returns all failures instead of hiding them when every item fails", async () => {
    const result = await submitBatchItems(["a", "b"], async () => {
      throw new Error("provider settings are incomplete");
    });

    expect(result.results).toEqual([]);
    expect(result.failures).toHaveLength(2);
    expect(result.summary).toEqual({
      requested: 2,
      submitted: 0,
      failedToSubmit: 2,
    });
  });
});
