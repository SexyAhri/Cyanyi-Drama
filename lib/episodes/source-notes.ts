import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import { chunkSource, mapSourceTasks, sourceAnalysisConcurrency, type SourceTaskHooks } from "./long-source";
import { resolveEpisodeTextProvider } from "./provider";
import { currentProductionConfiguration } from "@/lib/production-configuration/context";
import { workflowCacheFingerprint } from "@/lib/workflow/cache-fingerprint";
import { recordWorkflowArtifactReuse } from "@/lib/workflow/request-events";

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
  async function summarize(text: string, ref: string, merge: boolean) {
    await input.hooks?.assertActive();
    const prompt = renderPrompt({ id: PROMPT_IDS.SOURCE_NOTES, locale: input.locale, variables: {
      source_text: text, output_schema: JSON.stringify(z.toJSONSchema(NotesSchema)), extraction_task:
        `${merge ? "按顺序合并本集原文笔记" : "提取本段原文的改编依据"}：保留关键事件、人物关系、对白短引用、场景道具、世界限制和结尾状态。为有限时长的改编提炼重点，不提前发生事件。`,
    } });
    const key = workflowCacheFingerprint({
      source: { reference: ref, text },
      prompt,
      promptVersion: "adaptation-notes-v2",
      channelId: input.channelId,
      model: input.model,
      agentConfiguration: currentProductionConfiguration()?.snapshot ?? null,
      parameters: {
        temperature: 0.2,
        stream: false,
        structuredOutputMode: provider.structuredOutputMode,
        schema: z.toJSONSchema(NotesSchema),
      },
    });
    const requestId = randomUUID();
    const requestBase = {
      requestId,
      requestType: merge ? "adaptation_notes_merge" : "adaptation_notes_chunk",
      targetType: merge ? "adaptation_notes_group" : "adaptation_notes_chunk",
      targetId: key,
      provider: input.channelId,
      model: input.model,
      inputHash: key,
      cacheVersion: "workflow-cache-v2",
      promptVersion: String(prompt.version),
      promptVersionHash: prompt.versionHash,
    };
    const requestInput = { sourceRange: ref, text };
    const cached = NotesSchema.safeParse(await input.hooks?.loadArtifact("adaptation.notes", key));
    if (cached.success) {
      await recordWorkflowArtifactReuse({
        recordRequest: input.hooks?.recordRequest,
        request: { ...requestBase, input: requestInput },
        artifactRefs: [`adaptation.notes:${key}`],
        reuseReason: "cache_fingerprint_match",
      });
      return cached.data.notes;
    }
    await input.hooks?.recordRequest?.({ ...requestBase, status: "running", input: requestInput });
    try {
      const result = await requestOpenAiStructured({ ...provider, schema: NotesSchema, temperature: 0.2, stream: false,
        prompt,
      });
      await input.hooks?.assertActive();
      await input.hooks?.persistArtifact("adaptation.notes", key, result.data);
      await input.hooks?.persistArtifact("prompt.trace", key, result.trace);
      await input.hooks?.recordRequest?.({ ...requestBase, status: "succeeded",
        artifactRefs: [`adaptation.notes:${key}`, `prompt.trace:${key}`] });
      return result.data.notes;
    } catch (error) {
      await input.hooks?.recordRequest?.({ ...requestBase, status: "failed",
        error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
  const chunks = chunkSource(input.source);
  const concurrency = sourceAnalysisConcurrency();
  let completed = 0;
  const notes = await mapSourceTasks(chunks, concurrency, async chunk => {
    const note = await summarize(chunk.text, `${chunk.start}:${chunk.end}`, false);
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
    const next = await mapSourceTasks(groups, concurrency, (text, index) => summarize(text,
      `${depth}:${index}`, true));
    level = next; depth++;
  }
  return level.join("\n\n");
}
