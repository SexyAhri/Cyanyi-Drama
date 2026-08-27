import { describe, expect, it } from "vitest";

import { getStudioAgentIntent } from "./agent-runtime";

describe("studio agent intent", () => {
  it("requires both an action and an explicit operation target", () => {
    expect(getStudioAgentIntent("检查当前阶段")).toBeNull();
    expect(getStudioAgentIntent("重试一下")).toBeNull();
  });

  it("maps bilingual task and workflow actions", () => {
    expect(getStudioAgentIntent("重试失败媒体任务")).toBe("retry_media_task");
    expect(getStudioAgentIntent("cancel the running workflow")).toBe("cancel_workflow");
    expect(getStudioAgentIntent("暂停工作流")).toBe("pause_workflow");
    expect(getStudioAgentIntent("resume workflow")).toBe("resume_workflow");
  });
});
