import {
  productionConfigurationPatchSchema,
  type ProductionConfigurationPatch,
} from "./contract";
function configurationValues(
  patch: ProductionConfigurationPatch,
): Record<string, unknown> {
  return Object.fromEntries([
    ...(["sound", "workflow"] as const).flatMap((group) =>
      Object.entries(patch[group] ?? {}).map(([key, value]) => [
        group + "." + key,
        value,
      ]),
    ),
    ...Object.entries(patch.agents ?? {}).flatMap(([id, agent]) =>
      Object.entries(agent).map(([key, value]) => [
        "agents." + id + "." + key,
        value,
      ]),
    ),
  ]);
}
export function configurationFields(patch: ProductionConfigurationPatch) {
  return Object.keys(configurationValues(patch));
}
export function configurationDiff(
  before: ProductionConfigurationPatch,
  after: ProductionConfigurationPatch,
) {
  const a = configurationValues(before),
    b = configurationValues(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .sort()
    .flatMap((field) =>
      JSON.stringify(a[field]) === JSON.stringify(b[field])
        ? []
        : [{ field, before: a[field], after: b[field] }],
    );
}
export function selectConfigurationFields(
  patch: ProductionConfigurationPatch,
  fields: string[],
): ProductionConfigurationPatch {
  const selected = new Set(fields);
  return productionConfigurationPatchSchema.parse({
    ...Object.fromEntries(
      (["sound", "workflow"] as const).map((group) => [
        group,
        Object.fromEntries(
          Object.entries(patch[group] ?? {}).filter(([key]) =>
            selected.has(group + "." + key),
          ),
        ),
      ]),
    ),
    agents: Object.fromEntries(
      Object.entries(patch.agents ?? {})
        .map(
          ([id, agent]) =>
            [
              id,
              Object.fromEntries(
                Object.entries(agent).filter(([key]) =>
                  selected.has("agents." + id + "." + key),
                ),
              ),
            ] as const,
        )
        .filter(([, agent]) => Object.keys(agent).length),
    ),
  });
}
export function mergeConfigurationFields(
  draft: ProductionConfigurationPatch,
  incoming: ProductionConfigurationPatch,
): ProductionConfigurationPatch {
  const patch = productionConfigurationPatchSchema.parse(draft);
  const overrides = productionConfigurationPatchSchema.parse(incoming);
  if (overrides.sound) patch.sound = { ...patch.sound, ...overrides.sound };
  if (overrides.workflow)
    patch.workflow = { ...patch.workflow, ...overrides.workflow };
  if (overrides.agents) {
    patch.agents = { ...patch.agents };
    for (const [id, agent] of Object.entries(overrides.agents)) {
      patch.agents[id] = { ...patch.agents[id], ...agent };
    }
  }
  return patch;
}
