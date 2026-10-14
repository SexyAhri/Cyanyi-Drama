import { describe, expect, it } from "vitest";
import { compareConfigurationEdits, mergeConfigurationEdits } from "./conflict-contract";
import { productionConfigurationPatchSchema, type ProductionConfigurationPatch } from "./contract";

const agentId = "production_storyboard-generation";
const modelField = `agents.${agentId}.model`;
const agent = (value: NonNullable<ProductionConfigurationPatch["agents"]>[string]): ProductionConfigurationPatch => ({ agents: { [agentId]: value } });

describe("configuration conflict comparison and merge", () => {
  it("ignores empty containers and unchanged fields", () => {
    expect(compareConfigurationEdits({}, { sound: {}, agents: {}, workflow: {} }, {})).toEqual([]);
    expect(compareConfigurationEdits({ sound: { dialogue: false } }, { sound: { dialogue: false } }, { sound: { dialogue: false } })).toEqual([]);
  });

  it("compares the original, local and remote values", () => {
    expect(compareConfigurationEdits({ sound: { music: "off" } }, { sound: { music: "post" } }, { sound: { music: "designed" } })).toEqual([
      { field: "sound.music", fields: ["sound.music"], base: ["off"], local: ["post"], remote: ["designed"], resolution: "conflict" },
    ]);
  });

  it("retains independent edits from both sides and unchanged overrides", () => {
    const base: ProductionConfigurationPatch = { sound: { dialogue: true, effects: false }, workflow: { concurrency: 2 } };
    const local: ProductionConfigurationPatch = { ...base, sound: { ...base.sound, dialogue: false } };
    const remote: ProductionConfigurationPatch = { ...base, workflow: { concurrency: 4 } };
    expect(compareConfigurationEdits(base, local, remote).map(change => change.resolution)).toEqual(["local", "remote"]);
    expect(mergeConfigurationEdits(base, local, remote, {})).toEqual({ sound: { dialogue: false, effects: false }, agents: {}, workflow: { concurrency: 4 } });
  });

  it("accepts identical edits without requiring a choice", () => {
    const next: ProductionConfigurationPatch = { workflow: { concurrency: 3 } };
    expect(compareConfigurationEdits({}, next, next)[0].resolution).toBe("same");
    expect(mergeConfigurationEdits({}, next, next, {}).workflow).toEqual(next.workflow);
  });

  it("blocks unresolved conflicting edits", () => {
    expect(() => mergeConfigurationEdits({}, { sound: { dialogue: false } }, { sound: { dialogue: true } }, {})).toThrow("Unresolved configuration conflict");
  });

  it.each(["local", "remote"] as const)("respects the explicit %s choice", choice => {
    const result = mergeConfigurationEdits({}, { sound: { music: "off" } }, { sound: { music: "post" } }, { "sound.music": choice });
    expect(result.sound?.music).toBe(choice === "local" ? "off" : "post");
  });

  it("retains local restoration to inheritance and unrelated remote fields", () => {
    const result = mergeConfigurationEdits({ sound: { dialogue: false } }, {}, { sound: { dialogue: false, ambience: false } }, {});
    expect(result.sound).toEqual({ ambience: false });
  });

  it("retains remote restoration to inheritance and unrelated local fields", () => {
    const result = mergeConfigurationEdits({ sound: { dialogue: false } }, { sound: { dialogue: false, effects: false } }, {}, {});
    expect(result.sound).toEqual({ effects: false });
  });

  it("treats deletion versus modification as a conflict", () => {
    const base: ProductionConfigurationPatch = { sound: { music: "off" } };
    const remote: ProductionConfigurationPatch = { sound: { music: "post" } };
    expect(compareConfigurationEdits(base, {}, remote)[0].resolution).toBe("conflict");
    expect(mergeConfigurationEdits(base, {}, remote, { "sound.music": "local" }).sound).toEqual({});
    expect(mergeConfigurationEdits(base, {}, remote, { "sound.music": "remote" }).sound).toEqual(remote.sound);
  });

  it("does not materialize inherited defaults", () => {
    expect(mergeConfigurationEdits({}, {}, {}, {})).toEqual({ sound: {}, workflow: {}, agents: {} });
    expect(compareConfigurationEdits({}, { sound: { dialogue: true } }, {})[0]).toMatchObject({ base: [undefined], local: [true] });
  });

  it("preserves false, zero and empty string values", () => {
    const patch: ProductionConfigurationPatch = { sound: { dialogue: false, voiceDirection: "" }, workflow: { maxCorrections: 0 } };
    expect(mergeConfigurationEdits({}, patch, {}, {})).toMatchObject(patch);
  });

  it("treats arrays and full templates as atomic fields", () => {
    const base = agent({ disabledOperations: ["a"], templateZh: "{{task_snapshot}}\nBase" });
    const local = agent({ disabledOperations: [], templateZh: "{{task_snapshot}}\nLocal" });
    const remote = agent({ disabledOperations: ["b"], templateZh: "{{task_snapshot}}\nRemote" });
    expect(compareConfigurationEdits(base, local, remote)).toHaveLength(2);
    const result = mergeConfigurationEdits(base, local, remote, {
      [`agents.${agentId}.disabledOperations`]: "local", [`agents.${agentId}.templateZh`]: "remote",
    });
    expect(result.agents?.[agentId]).toEqual({ disabledOperations: [], templateZh: "{{task_snapshot}}\nRemote" });
  });

  it("groups a model and channel in a single conflict", () => {
    const base = agent({ channelId: "base-channel", model: "base-model" });
    const local = agent({ channelId: "local-channel", model: "base-model" });
    const remote = agent({ channelId: "base-channel", model: "remote-model" });
    expect(compareConfigurationEdits(base, local, remote)).toEqual([{
      field: modelField, fields: [`agents.${agentId}.channelId`, modelField],
      base: ["base-channel", "base-model"], local: ["local-channel", "base-model"], remote: ["base-channel", "remote-model"], resolution: "conflict",
    }]);
    expect(mergeConfigurationEdits(base, local, remote, { [modelField]: "local" }).agents?.[agentId]).toEqual(local.agents?.[agentId]);
    expect(mergeConfigurationEdits(base, local, remote, { [modelField]: "remote" }).agents?.[agentId]).toEqual(remote.agents?.[agentId]);
  });

  it("removes both model and channel when choosing inheritance", () => {
    const base = agent({ channelId: "base", model: "base", temperature: 0.5 });
    const local = agent({ temperature: 0.5 });
    const remote = agent({ channelId: "remote", model: "remote", temperature: 0.7 });
    expect(mergeConfigurationEdits(base, local, remote, { [modelField]: "local" }).agents?.[agentId]).toEqual({ temperature: 0.7 });
  });

  it("keeps edits from separate Agents isolated", () => {
    const result = mergeConfigurationEdits({}, agent({ temperature: 0 }), { agents: { another: { temperature: 1 } } }, {});
    expect(result.agents).toEqual({ [agentId]: { temperature: 0 }, another: { temperature: 1 } });
  });

  it("does not mutate input drafts or arrays", () => {
    const base = agent({ disabledOperations: ["a"] });
    const local = agent({ disabledOperations: [] });
    const remote = agent({ disabledOperations: ["b"] });
    const originals = structuredClone([base, local, remote]);
    const result = mergeConfigurationEdits(base, local, remote, { [`agents.${agentId}.disabledOperations`]: "remote" });
    result.agents![agentId].disabledOperations!.push("c");
    expect([base, local, remote]).toEqual(originals);
  });

  it("validates the resulting selected values", () => {
    const invalid = { workflow: { concurrency: 100 } } as ProductionConfigurationPatch;
    expect(() => mergeConfigurationEdits({}, invalid, {}, {})).toThrow();
    const valid = mergeConfigurationEdits({}, invalid, { workflow: { concurrency: 4 } }, { "workflow.concurrency": "remote" });
    expect(productionConfigurationPatchSchema.safeParse(valid).success).toBe(true);
  });
});
