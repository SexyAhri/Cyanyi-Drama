import { z } from "zod";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import { chunkSource, sourceFingerprint, type SourceTaskHooks } from "./long-source";
import { resolveEpisodeTextProvider } from "./provider";

const NotesSchema = z.object({ notes: z.string().min(1).max(1600) });

/** Hierarchical, source-grounded adaptation context. Every original span remains in saved checkpoints. */
export async function condenseAdaptationSource(input: {
  source: string; userId: string; channelId: string; model: string; locale?: "zh" | "en";
  onProgress?: (message: string) => void; hooks?: SourceTaskHooks;
}) {
  const provider = await resolveEpisodeTextProvider(input);
  async function summarize(text: string, key: string, merge: boolean) {
    await input.hooks?.assertActive();
    const cached = NotesSchema.safeParse(await input.hooks?.loadArtifact("adaptation.notes", key));
    if (cached.success) return cached.data.notes;
    const result = await requestOpenAiStructured({ ...provider, schema: NotesSchema, temperature: 0.2,
      prompt: renderPrompt({ id: PROMPT_IDS.STORY_PACKAGE_GENERATION, locale: input.locale, variables: {
        project_context: text, episode_count: "1", generation_task:
          `${merge ? "按顺序合并本集原文笔记" : "提取本段原文的改编依据"}：按发生顺序保留关键事件、因果关系、人物名和关系、对白短引用、场景道具、世界限制和结尾状态。不得新增或提前发生事件。为有限时长的改编提炼重点，信息不确定必须明确注明。只返回 JSON ${JSON.stringify(z.toJSONSchema(NotesSchema))}`,
      } }),
    });
    await input.hooks?.assertActive();
    await input.hooks?.persistArtifact("adaptation.notes", key, result.data);
    await input.hooks?.persistArtifact("prompt.trace", key, result.trace);
    return result.data.notes;
  }
  const chunks = chunkSource(input.source);
  const notes: string[] = [];
  for (const chunk of chunks) {
    input.onProgress?.(`正在提取本集原文依据 ${chunk.index + 1}/${chunks.length}`);
    await input.hooks?.reportProgress?.(`正在提取本集原文依据 ${chunk.index + 1}/${chunks.length}`);
    notes.push(await summarize(chunk.text, sourceFingerprint({ start: chunk.start, text: chunk.text,
      model: input.model, channelId: input.channelId, version: 1 }), false));
  }
  let level = notes, depth = 0;
  while (level.join("\n\n").length > 12_000) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 6) {
      const text = level.slice(index, index + 6).join("\n\n");
      input.onProgress?.(`正在合并原文依据，第 ${depth + 1} 层`);
      await input.hooks?.reportProgress?.(`正在合并原文依据，第 ${depth + 1} 层`);
      next.push(await summarize(text, sourceFingerprint({ text, depth, model: input.model,
        channelId: input.channelId, version: 1 }), true));
    }
    level = next; depth++;
  }
  return level.join("\n\n");
}
