import { describe, expect, it } from "vitest";
import { mapSourceTasks } from "./long-source";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("bounded source tasks", () => {
  it("runs only the configured number of requests and keeps source order", async () => {
    const gates = Array.from({ length: 4 }, () => deferred<string>());
    const started: number[] = [];
    const thirdStarted = deferred<void>();
    const result = mapSourceTasks([0, 1, 2, 3], 2, async index => {
      started.push(index);
      if (index === 2) thirdStarted.resolve();
      return gates[index].promise;
    });
    expect(started).toEqual([0, 1]);
    gates[1].resolve("one");
    await thirdStarted.promise;
    expect(started).toEqual([0, 1, 2]);
    gates[2].resolve("two");
    gates[0].resolve("zero");
    gates[3].resolve("three");
    expect(await result).toEqual(["zero", "one", "two", "three"]);
  });

  it("stops new requests on error and waits for the other in-flight request", async () => {
    const gates = [deferred<number>(), deferred<number>()];
    const started: number[] = [];
    const failure = new Error("MODEL_RATE_LIMITED");
    const result = mapSourceTasks([0, 1, 2, 3], 2, async index => {
      started.push(index);
      return gates[index].promise;
    });
    let settled = false;
    const outcome = result.then(() => { settled = true; return null; }, error => {
      settled = true; return error;
    });
    gates[0].reject(failure);
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(started).toEqual([0, 1]);
    gates[1].resolve(1);
    expect(await outcome).toBe(failure);
    expect(started).toEqual([0, 1]);
  });
});
