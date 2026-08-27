import { describe, expect, it } from "vitest";

import { canReuseWorkspaceRequest } from "./use-workspace";

describe("workspace request reuse", () => {
  it("does not reuse a request canceled by strict-mode cleanup", () => {
    const controller = new AbortController();
    const request = { projectId: "project-1", signal: controller.signal };
    expect(canReuseWorkspaceRequest(request, "project-1")).toBe(true);
    controller.abort();
    expect(canReuseWorkspaceRequest(request, "project-1")).toBe(false);
  });

  it("does not reuse a request for another project", () => {
    expect(
      canReuseWorkspaceRequest({ projectId: "project-1" }, "project-2"),
    ).toBe(false);
  });
});
