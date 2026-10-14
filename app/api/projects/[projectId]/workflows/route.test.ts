import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  attach: vi.fn(),
  enqueue: vi.fn(),
  create: vi.fn(),
  assertScope: vi.fn(),
  resolve: vi.fn(),
  settings: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({ ensureAnonymousUser: mocks.auth, attachSessionCookie: mocks.attach }));
vi.mock("@/lib/queue/workflow-queue", () => ({ enqueueWorkflowJob: mocks.enqueue }));
vi.mock("@/lib/workflow/store", () => ({ createOrReuseWorkflowRun: mocks.create, listWorkflowRunSummaries: vi.fn() }));
vi.mock("@/lib/production-configuration/store", () => ({ assertConfigurationScope: mocks.assertScope, resolveProductionConfiguration: mocks.resolve }));
vi.mock("@/lib/settings/runtime-store", () => ({ loadUserRuntimeSettings: mocks.settings }));

import { POST } from "./route";

const request = (body: unknown) => new Request("http://localhost/api/projects/project/workflows", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner" }, sessionId: "session" });
  mocks.attach.mockImplementation((response) => response);
  mocks.settings.mockResolvedValue({ workflowStepMaxAttempts: 3 });
  mocks.resolve.mockResolvedValue({ workflow: {
    retryMode: "restart",
    requestTimeoutSeconds: 600,
    transportAttempts: 1,
    maxCorrections: 0,
    concurrency: 2,
    templates: {
      "story-to-script": [{
        key: "organize_production_script",
        enabled: true,
        dependsOn: [],
        retryable: false,
        maxAttempts: 1,
      }],
    },
  } });
  mocks.create.mockResolvedValue({ workflow: { id: "workflow-1" }, reused: false });
});

describe("project workflow template settings", () => {
  it("pins the published config hash and uses the registered graph instead of a client supplied graph", async () => {
    const response = await POST(request({
      workflowType: "story-to-script",
      steps: [{ key: "forged", type: "unconfigured", maxAttempts: 10 }],
      input: { concurrency: 7 },
    }), { params: Promise.resolve({ projectId: "project" }) });

    expect(response.status).toBe(202);
    expect(mocks.assertScope).toHaveBeenCalledWith("owner", { projectId: "project" });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project",
      workflowType: "story-to-script",
      input: { concurrency: 2 },
      expectedConfigurationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      steps: [expect.objectContaining({
        key: "organize_production_script",
        retryable: true,
        maxAttempts: 3,
      })],
    }));
    expect(mocks.enqueue).toHaveBeenCalledOnce();
  });

});
