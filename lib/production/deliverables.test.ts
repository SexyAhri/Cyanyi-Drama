import { describe, expect, it } from "vitest";

import {
  departmentOwnsDeliverableType,
  getProductionDepartment,
  PRODUCTION_DEPARTMENTS,
} from "./departments";
import {
  canTransitionProductionDeliverable,
  createDependencyHash,
} from "./deliverables";

describe("production departments", () => {
  it("assigns art direction and VFX to distinct departments", () => {
    expect(getProductionDepartment("art")?.agents).toContain("art_director");
    expect(getProductionDepartment("vfx")?.agents).toContain("vfx_supervisor");
    expect(
      departmentOwnsDeliverableType("development", "production_bible"),
    ).toBe(true);
    expect(departmentOwnsDeliverableType("art", "visual_bible")).toBe(true);
    expect(departmentOwnsDeliverableType("art", "vfx_breakdown")).toBe(false);
    expect(departmentOwnsDeliverableType("vfx", "vfx_breakdown")).toBe(true);
  });

  it("keeps every deliverable type owned by one department", () => {
    const types = PRODUCTION_DEPARTMENTS.flatMap(
      (department) => department.deliverableTypes,
    );
    expect(new Set(types).size).toBe(types.length);
  });
});

describe("production deliverable lifecycle", () => {
  it("requires review and approval before locking", () => {
    expect(canTransitionProductionDeliverable("draft", "submit")).toBe(true);
    expect(canTransitionProductionDeliverable("draft", "lock")).toBe(false);
    expect(canTransitionProductionDeliverable("review", "approve")).toBe(true);
    expect(canTransitionProductionDeliverable("review", "lock")).toBe(false);
    expect(canTransitionProductionDeliverable("approved", "lock")).toBe(true);
  });

  it("requires a new version for stale deliverables", () => {
    expect(canTransitionProductionDeliverable("stale", "submit")).toBe(false);
    expect(canTransitionProductionDeliverable("superseded", "submit")).toBe(false);
  });

  it("hashes dependency versions independent of input order", () => {
    const first = createDependencyHash([
      { id: "script", version: 2 },
      { id: "bible", version: 4 },
    ]);
    const second = createDependencyHash([
      { id: "bible", version: 4 },
      { id: "script", version: 2 },
    ]);
    expect(first).toBe(second);
    expect(first).not.toBe(
      createDependencyHash([{ id: "script", version: 3 }]),
    );
  });
});
