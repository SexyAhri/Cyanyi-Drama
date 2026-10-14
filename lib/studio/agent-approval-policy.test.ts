import { describe, expect, it } from "vitest";
import {
  studioAgentApprovalGranted,
  studioAgentConfirmationMode,
} from "./agent-approval-policy";

describe("Studio Agent confirmation policy", () => {
  it("keeps suggestions separate from operations and classifies writes by impact", () => {
    expect(studioAgentConfirmationMode("read_project_object")).toBe("automatic_read");
    expect(studioAgentConfirmationMode("update_canvas_prompt")).toBe("draft_confirmation");
    expect(studioAgentConfirmationMode("start_storyboard_generation")).toBe("task_confirmation");
    expect(studioAgentConfirmationMode("unrecognized_operation")).toBe("task_confirmation");
  });

  it("allows no task or draft operation unless its explicit approval is granted", () => {
    expect(studioAgentApprovalGranted("update_canvas_prompt", "denied")).toBe(false);
    expect(studioAgentApprovalGranted("update_canvas_prompt", "approved")).toBe(true);
    expect(studioAgentApprovalGranted("start_storyboard_generation", "denied")).toBe(false);
    expect(studioAgentApprovalGranted("start_storyboard_generation", "approved")).toBe(true);
    expect(studioAgentApprovalGranted("read_project_object", "approved")).toBe(false);
  });
});
