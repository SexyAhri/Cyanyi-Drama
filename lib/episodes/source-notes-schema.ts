import { z } from "zod";

const entry = z.object({ name: z.string().min(1).max(60), details: z.string().min(1).max(160) });
export const ManuscriptNotesSchema = z.object({
  summary: z.string().min(1).max(1200),
  characters: z.array(entry).max(10), locations: z.array(entry).max(10), props: z.array(entry).max(10),
  rules: z.array(z.string().min(1).max(160)).max(8),
});
export const AdaptationNotesSchema = z.object({ notes: z.string().min(1).max(1600) });
export const SourceNotesSchema = z.union([ManuscriptNotesSchema, AdaptationNotesSchema]);
