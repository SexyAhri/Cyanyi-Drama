import type { ProductionConfigurationPatch } from "./contract";
import {
  configurationDiff,
  configurationFields,
  selectConfigurationFields,
} from "./diff";
import { mergeConfigurationFields } from "./diff";

export type ConfigurationConflictChoice = "local" | "remote";
export type ConfigurationComparison = {
  field: string;
  fields: string[];
  base: unknown[];
  local: unknown[];
  remote: unknown[];
  resolution: "local" | "remote" | "same" | "conflict";
};

/** Model and channel form one choice; arrays and template strings stay atomic. */
export function compareConfigurationEdits(
  base: ProductionConfigurationPatch,
  local: ProductionConfigurationPatch,
  remote: ProductionConfigurationPatch,
): ConfigurationComparison[] {
  const values = [base, local, remote].map((patch) =>
    Object.fromEntries(
      configurationDiff({}, patch).map((change) => [
        change.field,
        change.after,
      ]),
    ),
  );
  const fields = [
    ...new Set([base, local, remote].flatMap(configurationFields)),
  ].sort();
  const groups = new Map<string, string[]>();
  for (const field of fields) {
    const modelPair =
      field.startsWith("agents.") &&
      (field.endsWith(".model") || field.endsWith(".channelId"));
    const key = modelPair
      ? field.slice(0, field.lastIndexOf(".")) + ".model"
      : field;
    if (!groups.has(key))
      groups.set(
        key,
        modelPair
          ? [key.slice(0, key.lastIndexOf(".")) + ".channelId", key]
          : [field],
      );
  }
  return [...groups].flatMap(([field, fields]) => {
    const [base, local, remote] = values.map((value) =>
      fields.map((key) => value[key]),
    );
    const localChanged = JSON.stringify(local) !== JSON.stringify(base);
    const remoteChanged = JSON.stringify(remote) !== JSON.stringify(base);
    if (!localChanged && !remoteChanged) return [];
    const resolution = !localChanged
      ? "remote"
      : !remoteChanged
        ? "local"
        : JSON.stringify(local) === JSON.stringify(remote)
          ? "same"
          : "conflict";
    return [{ field, fields, base, local, remote, resolution }];
  });
}

/** Explicit removals must stay removed; never replace an unresolved conflict. */
export function mergeConfigurationEdits(
  base: ProductionConfigurationPatch,
  local: ProductionConfigurationPatch,
  remote: ProductionConfigurationPatch,
  choices: Record<string, ConfigurationConflictChoice>,
): ProductionConfigurationPatch {
  const localFields = new Set<string>();
  for (const change of compareConfigurationEdits(base, local, remote)) {
    const choice =
      change.resolution === "conflict"
        ? choices[change.field]
        : change.resolution === "remote"
          ? "remote"
          : "local";
    if (choice !== "local" && choice !== "remote")
      throw new Error("Unresolved configuration conflict: " + change.field);
    if (choice === "local")
      change.fields.forEach((field) => localFields.add(field));
  }
  return mergeConfigurationFields(
    selectConfigurationFields(
      remote,
      configurationFields(remote).filter((field) => !localFields.has(field)),
    ),
    selectConfigurationFields(local, [...localFields]),
  );
}
