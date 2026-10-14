import { z } from "zod";
import {
  agentConfigurationSchema,
  soundPolicySchema,
  type ProductionConfigurationPatch,
  type ProductionConfigurationSnapshot,
} from "./contract";

export const managementConfigurationPatchSchema = z
  .object({
    agents: z
      .record(z.string().min(1).max(100), agentConfigurationSchema)
      .optional(),
    sound: soundPolicySchema.pick({ mode: true }).partial().optional(),
  })
  .strict();

export function managementValues(snapshot: ProductionConfigurationSnapshot) {
  return {
    agents: snapshot.agents,
    sound: { mode: snapshot.sound.mode },
    sources: snapshot.sources,
  };
}

/** Only these fields remain live. Full historical schemas are for frozen tasks. */
export function retainedConfiguration(
  value: unknown,
  scopeKey: string,
): ProductionConfigurationPatch {
  const patch = z.object({ agents: z.unknown().optional(), sound: z.object({ mode: soundPolicySchema.shape.mode.optional() }).strip().optional() }).strip().parse(value ?? {});
  return managementConfigurationPatchSchema.parse({
    ...(scopeKey === "user" && patch.agents ? { agents: patch.agents } : {}),
    ...(patch.sound?.mode ? { sound: { mode: patch.sound.mode } } : {}),
  });
}

export type ProductionManagementSection = "agents" | "sound";

/** Select the editable domain without exposing or publishing unrelated drafts. */
export function managementPatch(
  patch: ProductionConfigurationPatch,
  section: ProductionManagementSection,
): ProductionConfigurationPatch {
  return section === "agents"
    ? { agents: patch.agents ?? {} }
    : { sound: patch.sound?.mode ? { mode: patch.sound.mode } : {} };
}

export function replaceManagementSection(
  base: ProductionConfigurationPatch,
  patch: ProductionConfigurationPatch,
  section: ProductionManagementSection,
): ProductionConfigurationPatch {
  if (section === "agents")
    return { ...base, ...managementPatch(patch, section) };
  const sound = { ...base.sound };
  if (patch.sound?.mode) sound.mode = patch.sound.mode;
  else delete sound.mode;
  return { ...base, sound };
}
