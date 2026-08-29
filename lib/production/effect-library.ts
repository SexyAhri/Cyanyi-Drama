export function extractProjectEffectLibrary(
  screenplays: readonly (string | null)[],
) {
  const effects: Array<{
    key: string;
    technique: string | null;
    kind: string;
    performer: string;
    visualMotif: string;
    visualMotifSource: string | null;
    visualMotifRationale: string | null;
    vfxPlan: unknown[];
  }> = [];
  const seen = new Set<string>();
  for (const screenplay of screenplays) {
    const parsed = parseJsonRecord(screenplay);
    const scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
    for (const scene of scenes) {
      if (!isRecord(scene) || !Array.isArray(scene.content)) continue;
      for (const content of scene.content) {
        if (!isRecord(content) || !isRecord(content.actionDesign)) continue;
        const design = content.actionDesign;
        const visualMotif = stringValue(design.visualMotif);
        const kind = stringValue(design.kind);
        const performer = stringValue(design.performer);
        if (!visualMotif || !kind || !performer) continue;
        const technique = stringValue(design.technique);
        const key = technique
          ? `technique:${technique}`
          : `${kind}:${performer}`;
        if (seen.has(key)) continue;
        seen.add(key);
        effects.push({
          key,
          technique,
          kind,
          performer,
          visualMotif,
          visualMotifSource: stringValue(design.visualMotifSource),
          visualMotifRationale: stringValue(design.visualMotifRationale),
          vfxPlan: Array.isArray(design.vfxPlan) ? design.vfxPlan : [],
        });
      }
    }
  }
  return effects.slice(0, 100);
}

function parseJsonRecord(value: string | null) {
  try {
    const parsed: unknown = value ? JSON.parse(value) : null;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
