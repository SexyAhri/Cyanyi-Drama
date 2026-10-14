export type StudioAgentConfirmationMode = "automatic_read" | "draft_confirmation" | "task_confirmation";

export function studioAgentConfirmationMode(operation: string): StudioAgentConfirmationMode {
  if (operation === "read_project_object") return "automatic_read";
  if (operation === "update_canvas_prompt") return "draft_confirmation";
  return "task_confirmation";
}

export function studioAgentApprovalGranted(
  operation: string,
  decision: "approved" | "denied",
) {
  return studioAgentConfirmationMode(operation) !== "automatic_read" && decision === "approved";
}
