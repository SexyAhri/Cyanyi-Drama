import { z } from "zod";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import { chunkSource, mapSourceTasks, sourceAnalysisConcurrency, sourceFingerprint, type SourceTaskHooks } from "./long-source";
import { resolveEpisodeTextProvider } from "./provider";

import { AdaptationNotesSchema as NotesSchema } from "./source-notes-schema";

/** Hierarchical, source-grounded adaptation context. Every original span remains in saved checkpoints. */
export async function condenseAdaptationSource(input: {
  source: string; userId: string; channelId: string; model: string; locale?: "zh" | "en";
  onProgress?: (message: string) => void; hooks?: SourceTaskHooks;
}) {
  const provider = await resolveEpisodeTextProvider(input);
  let progress = Promise.resolve();
  const reportProgress = (message: string) => {
    progress = progress.then(async () => {
      input.onProgress?.(message);
      await input.hooks?.reportProgress?.(message);
    });
    return progress;
  };
  async function summarize(text: string, key: string, merge: boolean) {
    await input.hooks?.assertActive();
    const cached = NotesSchema.safeParse(await input.hooks?.loadArtifact("adaptation.notes", key));
    if (cached.success) return cached.data.notes;
    const result = await requestOpenAiStructured({ ...provider, schema: NotesSchema, temperature: 0.2, stream: false,
      prompt: renderPrompt({ id: PROMPT_IDS.SOURCE_NOTES, locale: input.locale, variables: {
        source_text: text, output_schema: JSON.stringify(z.toJSONSchema(NotesSchema)), extraction_task:
          `${merge ? "按顺序合并本集原文笔记" : "提取本段原文的改编依据"}：保留关键事件、人物关系、对白短引用、场景道具、世界限制和结尾状态。为有限时长的改编提炼重点，不提前发生事件。`,
      } }),
    });
    await input.hooks?.assertActive();
    await input.hooks?.persistArtifact("adaptation.notes", key, result.data);
    await input.hooks?.persistArtifact("prompt.trace", key, result.trace);
    return result.data.notes;
  }
  const chunks = chunkSource(input.source);
  const concurrency = sourceAnalysisConcurrency();
  let completed = 0;
  const notes = await mapSourceTasks(chunks, concurrency, async chunk => {
    const note = await summarize(chunk.text, sourceFingerprint({ start: chunk.start, text: chunk.text,
      model: input.model, channelId: input.channelId, version: 1 }), false);
    const message = `已提取本集原文依据 ${++completed}/${chunks.length}（${concurrency} 路并发）`;
    await reportProgress(message);
    return note;
  });
  let level = notes, depth = 0;
  while (level.join("\n\n").length > 12_000) {
    const groups: string[] = [];
    for (let index = 0; index < level.length; index += 6) {
      groups.push(level.slice(index, index + 6).join("\n\n"));
    }
    const message = `正在合并原文依据，第 ${depth + 1} 层（${concurrency} 路并发）`;
    await reportProgress(message);
    const next = await mapSourceTasks(groups, concurrency, text => summarize(text,
      sourceFingerprint({ text, depth, model: input.model, channelId: input.channelId, version: 1 }), true));
    level = next; depth++;
  }
  return level.join("\n\n");
}
