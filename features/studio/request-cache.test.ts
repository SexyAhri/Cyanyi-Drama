import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cachedStudioRequest, invalidateStudioCache, peekStudioCache, setStudioCacheScope } from "./request-cache";

describe("fresh workflow output cache", () => {
  beforeEach(() => { vi.stubGlobal("window", {}); setStudioCacheScope("canvas-test"); invalidateStudioCache(undefined, true); });
  afterEach(() => { invalidateStudioCache(undefined, true); vi.unstubAllGlobals(); });
  it("forces a fresh read even inside the normal cache TTL", async () => {
    const load = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new");
    expect(await cachedStudioRequest("/asset", load)).toBe("old");
    expect(await cachedStudioRequest("/asset", load)).toBe("old");
    expect(await cachedStudioRequest("/asset", load, undefined, true)).toBe("new");
    expect(peekStudioCache("/asset")).toBe("new");
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("does not join an older request or let its late response overwrite new output", async () => {
    let complete!: (value: string) => void;
    const old = cachedStudioRequest("/asset", () => new Promise<string>(resolve => { complete = resolve; }));
    expect(await cachedStudioRequest("/asset", async () => "new", undefined, true)).toBe("new");
    complete("old"); await old;
    expect(peekStudioCache("/asset")).toBe("new");
  });
  it("does not refill another user scope with an old response", async () => {
    let complete!: (value: string) => void;
    const old = cachedStudioRequest("/asset", () => new Promise<string>(resolve => { complete = resolve; }));
    setStudioCacheScope("another-user"); complete("private"); await old;
    expect(peekStudioCache("/asset")).toBeUndefined();
  });
});
