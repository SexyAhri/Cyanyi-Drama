export type BatchSubmissionFailure = {
  item: unknown;
  message: string;
};

export type BatchSubmissionResult<Item, Value> = {
  results: Array<{ item: Item; value: Value }>;
  failures: Array<{ item: Item; message: string }>;
  summary: {
    requested: number;
    submitted: number;
    failedToSubmit: number;
  };
};

/** Keep processing independent items and retain both successes and failures. */
export async function submitBatchItems<Item, Value>(
  items: Item[],
  submit: (item: Item, index: number) => Promise<Value>,
  getErrorMessage: (error: unknown) => string = (error) =>
    error instanceof Error ? error.message : "Batch item submission failed.",
): Promise<BatchSubmissionResult<Item, Value>> {
  const results: Array<{ item: Item; value: Value }> = [];
  const failures: Array<{ item: Item; message: string }> = [];

  for (const [index, item] of items.entries()) {
    try {
      results.push({ item, value: await submit(item, index) });
    } catch (error) {
      failures.push({ item, message: getErrorMessage(error) });
    }
  }

  return {
    results,
    failures,
    summary: {
      requested: items.length,
      submitted: results.length,
      failedToSubmit: failures.length,
    },
  };
}
