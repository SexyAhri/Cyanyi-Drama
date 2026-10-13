import type { ProductionConfigurationPatch } from "@/lib/production-configuration/contract";

export function configurationDiff(before: ProductionConfigurationPatch, after: ProductionConfigurationPatch) {
  const flatten = (patch: ProductionConfigurationPatch) => {
    const fields: Record<string, unknown> = {};
    for (const group of ["sound", "workflow"] as const)
      for (const [key, value] of Object.entries(patch[group] ?? {})) fields[`${group}.${key}`] = value;
    for (const [id, agent] of Object.entries(patch.agents ?? {}))
      for (const [key, value] of Object.entries(agent)) fields[`agents.${id}.${key}`] = value;
    return fields;
  };
  const a = flatten(before), b = flatten(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap(field => JSON.stringify(a[field]) === JSON.stringify(b[field]) ? [] : [{ field, before: a[field], after: b[field] }]);
}
