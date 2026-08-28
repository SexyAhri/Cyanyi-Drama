import { describe, expect, it } from "vitest";

import {
  getStudioAgentIntent,
  selectScreenplayRevisionClip,
} from "./agent-runtime";

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
    expect(getStudioAgentIntent("根据报错修复这个剧本")).toBe(
      "revise_screenplay",
    );
  });

  it("prefers the selected eligible clip and rejects an unlisted target", () => {
    const clips = [
      { id: "clip-1", screenplay: "{}" },
      {
        id: "clip-2",
        screenplay: null,
        failureContext: { error: "STRUCTURED_SCHEMA_INVALID:scenes" },
      },
      {
        id: "clip-3",
        screenplay: null,
        failureContext: { error: "STRUCTURED_PROVIDER_TIMEOUT:120000" },
      },
    ];

    expect(selectScreenplayRevisionClip(clips, "clip-2")?.id).toBe("clip-2");
    expect(
      selectScreenplayRevisionClip(clips, "clip-2", "clip-not-listed"),
    ).toBeUndefined();
    expect(
      selectScreenplayRevisionClip(clips, undefined, "clip-3"),
    ).toBeUndefined();
  });
});
