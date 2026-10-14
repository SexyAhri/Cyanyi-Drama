import { describe, expect, it } from "vitest";

import { downstreamRetryStepKeys, workflowRetryStepKeys } from "./retry-scope";

const steps = [
  { stepKey: "prepare", stepIndex: 0, status: "succeeded", dependsOn: [] },
  { stepKey: "analyze", stepIndex: 1, status: "failed", dependsOn: ["prepare"] },
  { stepKey: "assets", stepIndex: 2, status: "succeeded", dependsOn: ["analyze"] },
  { stepKey: "finish", stepIndex: 3, status: "pending", dependsOn: ["assets"] },
  { stepKey: "independent", stepIndex: 4, status: "succeeded", dependsOn: [] },
];

describe("workflow retry scope preview", () => {
  it("includes a selected step and only its transitive dependents", () => {
    expect(downstreamRetryStepKeys(steps, "analyze")).toEqual([
      "analyze",
      "assets",
      "finish",
    ]);
  });

  it("includes incomplete workflow steps and their dependents", () => {
    expect(workflowRetryStepKeys(steps)).toEqual([
      "analyze",
      "assets",
      "finish",
    ]);
  });

  it("retries the final step when finalization failed after all steps succeeded", () => {
    expect(
      workflowRetryStepKeys(steps.map((step) => ({ ...step, status: "succeeded" }))),
    ).toEqual(["independent"]);
  });
});
