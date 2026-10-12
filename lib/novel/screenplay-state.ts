import { screenplayConversionSchema } from "@/lib/prompts/schemas";

/** Missing or malformed scripts cannot prove that an episode is silent. */
export function inspectStructuredScreenplay(value: string | null) {
  try {
    const result = screenplayConversionSchema.safeParse(JSON.parse(value ?? ""));
    if (result.success) return {
      structured: true,
      speechExpected: result.data.scenes.some(scene => scene.content.some(line =>
        line.type === "dialogue" || line.type === "voiceover")),
    };
  } catch { /* Incomplete legacy data needs organizing before production. */ }
  return { structured: false, speechExpected: true };
}
