import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import { createProductionDeliverable } from "@/lib/production/deliverables";
import { createOrReuseWorkflowRun } from "@/lib/workflow/store";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { resolveEpisodeTextProvider } from "./provider";
import { chunkSource, mapSourceTasks, sourceAnalysisConcurrency, sourceFingerprint, type SourceTaskHooks } from "./long-source";
import { parseNovelStructure } from "./novel-volumes";

import { ManuscriptNotesSchema } from "./source-notes-schema";
export { ManuscriptNotesSchema } from "./source-notes-schema";
export type ManuscriptNotes = z.infer<typeof ManuscriptNotesSchema>;
export type ManuscriptDossier = {
  packageFormat: "cyanyi-manuscript-dossier-v1"; manuscriptId: string; sourceHash: string;
  title: string; summary: ManuscriptNotes;
  chapters: Array<{ heading: string; startIndex: number; endIndex: number }>;
  chunks: Array<{ index: number; start: number; end: number; artifactRef: string }>;
};

export function manuscriptAnalysisConcurrency() {
  return sourceAnalysisConcurrency(process.env.MANUSCRIPT_ANALYSIS_CONCURRENCY ?? process.env.SOURCE_ANALYSIS_CONCURRENCY);
}

export async function startManuscriptAnalysis(input: {
  userId: string; projectId: string; manuscriptId: string; channelId: string; model: string; locale: "zh" | "en";
}) {
  await resolveEpisodeTextProvider(input);
  const manuscript = await prisma.manuscript.findFirst({ where: { id: input.manuscriptId,
    projectId: input.projectId, project: { userId: input.userId } }, select: { id: true, sourceHash: true } });
  if (!manuscript) throw new Error("原著不存在");
  const settings = await loadUserRuntimeSettings(input.userId);
  const workflowInput = { manuscriptId: manuscript.id, sourceHash: manuscript.sourceHash,
    channelId: input.channelId, model: input.model, locale: input.locale };
  const result = await createOrReuseWorkflowRun({ id: `workflow_${randomUUID()}`, userId: input.userId,
    projectId: input.projectId, workflowType: "manuscript-analysis", targetType: "manuscript", targetId: manuscript.id,
    input: workflowInput, steps: [{ key: "analyze_manuscript", type: "analyze_manuscript", input: workflowInput,
      artifactTypes: ["manuscript.chunk", "manuscript.merge", "manuscript.dossier", "prompt.trace"],
      retryable: true, maxAttempts: settings.workflowStepMaxAttempts }], maxAttempts: settings.workflowStepMaxAttempts });
  if (!result) throw new Error("项目不存在");
  if (!result.reused) await enqueueWorkflowJob({ runId: result.workflow.id, userId: input.userId,
    projectId: input.projectId, maxAttempts: settings.workflowStepMaxAttempts });
  return { submitted: true, workflowId: result.workflow.id, reused: result.reused, status: result.workflow.status };
}

export async function analyzeManuscript(input: {
  userId: string; projectId: string; manuscriptId: string; sourceHash: string;
  channelId: string; model: string; locale: "zh" | "en";
}, hooks: SourceTaskHooks) {
  const manuscript = await prisma.manuscript.findFirst({ where: { id: input.manuscriptId,
    projectId: input.projectId, project: { userId: input.userId } } });
  if (!manuscript || manuscript.sourceHash !== input.sourceHash) throw new Error("原著版本已变化，请重新建立资料");
  if (!manuscript.sourceText.trim()) throw new Error("原著内容为空，请先上传正文");
  const done = await hooks.loadArtifact("manuscript.dossier", manuscript.id) as { deliverableId?: string } | null;
  if (done?.deliverableId) return done;
  const provider = await resolveEpisodeTextProvider(input);
  const concurrency = manuscriptAnalysisConcurrency();
  // Load reusable notes once rather than querying earlier runs for every source span.
  // Fingerprints still bind exact text, source position, model and channel.
  const previous = await prisma.workflowArtifact.findMany({
    where: {
      artifactType: { in: ["manuscript.chunk", "manuscript.merge"] }, refId: { not: null },
      run: { userId: input.userId, projectId: input.projectId, targetId: input.manuscriptId,
        workflowType: "manuscript-analysis", status: { in: ["succeeded", "failed", "paused"] },
        input: { path: ["sourceHash"], equals: input.sourceHash } },
    },
    select: { artifactType: true, refId: true, payload: true },
    orderBy: { createdAt: "desc" },
  });
  const reusable = new Map<string, unknown>();
  for (const row of previous) {
    const key = `${row.artifactType}:${row.refId}`;
    if (!reusable.has(key)) reusable.set(key, row.payload);
  }
  let progress = Promise.resolve();
  const reportProgress = (message: string) => {
    progress = progress.then(async () => { await hooks.reportProgress?.(message); });
    return progress;
  };
  async function extract(type: string, ref: string, text: string, merge = false) {
    await hooks.assertActive();
    const key = sourceFingerprint({ ref, text, model: input.model, channel: input.channelId, version: 1 });
    const cached = ManuscriptNotesSchema.safeParse(await hooks.loadArtifact(type, key));
    if (cached.success) return { notes: cached.data, artifactRef: key };
    const reused = ManuscriptNotesSchema.safeParse(reusable.get(`${type}:${key}`));
    if (reused.success) {
      await hooks.persistArtifact(type, key, reused.data);
      return { notes: reused.data, artifactRef: key };
    }
    const result = await requestOpenAiStructured({ ...provider, schema: ManuscriptNotesSchema,
      timeoutMs: 120_000, temperature: 0.2,
      // This background task only consumes completed JSON and gains nothing from a long-lived SSE connection.
      stream: false,
      prompt: renderPrompt({ id: PROMPT_IDS.SOURCE_NOTES, locale: input.locale, variables: {
        source_text: text, output_schema: JSON.stringify(z.toJSONSchema(ManuscriptNotesSchema)),
        extraction_task: merge ? "合并有序原著资料，保留关键事件与人物、场景、道具及世界规则。" :
          "提取本段明确发生的事件及人物、场景、道具、世界规则。概要以约 600 字为目标，实体详情约 100 字，包含短引用；关键事实需要时可用结构允许的完整长度。",
      } }),
    });
    await hooks.assertActive();
    await hooks.persistArtifact(type, key, result.data);
    await hooks.persistArtifact("prompt.trace", key, result.trace);
    return { notes: result.data, artifactRef: key };
  }
  const sourceChunks = chunkSource(manuscript.sourceText);
  let completedChunks = 0;
  await reportProgress(`正在提取原著资料 0/${sourceChunks.length}（${concurrency} 路并发，复用已保存结果）`);
  const extracted = await mapSourceTasks(sourceChunks, concurrency, async chunk => {
    const result = await extract("manuscript.chunk", `${chunk.start}:${chunk.end}`, chunk.text);
    completedChunks++;
    await reportProgress(`已提取原著资料 ${completedChunks}/${sourceChunks.length}（${concurrency} 路并发）`);
    return { chunk: { index: chunk.index, start: chunk.start, end: chunk.end, artifactRef: result.artifactRef }, notes: result.notes };
  });
  const chunks = extracted.map(result => result.chunk);
  const chunkNotes = extracted.map(result => result.notes);
  // Bounded hierarchical reduction; never send every chunk summary in one model request.
  let level = chunkNotes;
  let depth = 0;
  while (level.length > 1) {
    const groups: Array<{ notes: ManuscriptNotes[]; ref: string }> = [];
    for (let start = 0; start < level.length;) {
      const group: ManuscriptNotes[] = [level[start++]];
      while (start < level.length && group.length < 6 &&
        JSON.stringify([...group, level[start]]).length <= 12_000) group.push(level[start++]);
      // Each note is bounded by the schema. Pairwise merge guarantees reduction.
      if (group.length === 1 && start < level.length) group.push(level[start++]);
      groups.push({ notes: group, ref: `${depth}:${start}` });
    }
    let completedGroups = 0;
    await reportProgress(`正在合并原著资料，第 ${depth + 1} 层 0/${groups.length}（${concurrency} 路并发）`);
    const next = await mapSourceTasks(groups, concurrency, async group => {
      await hooks.assertActive();
      const notes = group.notes.length === 1 ? group.notes[0]
        : (await extract("manuscript.merge", group.ref, JSON.stringify(group.notes), true)).notes;
      completedGroups++;
      await reportProgress(`正在合并原著资料，第 ${depth + 1} 层 ${completedGroups}/${groups.length}（${concurrency} 路并发）`);
      return notes;
    });
    level = next; depth++;
  }
  const structure = parseNovelStructure(manuscript.sourceText);
  const payload: ManuscriptDossier = { packageFormat: "cyanyi-manuscript-dossier-v1", manuscriptId: manuscript.id,
    sourceHash: manuscript.sourceHash, title: manuscript.title, summary: level[0], chunks,
    chapters: structure.volumes.flatMap(volume => volume.chapters.map(chapter => ({
      heading: `${volume.title} · ${chapter.heading}`, startIndex: chapter.startIndex, endIndex: chapter.endIndex,
    }))) };
  await hooks.assertActive();
  const deliverable = await createProductionDeliverable(input.userId, input.projectId, {
    department: "development", deliverableType: "story_bible", title: `${manuscript.title} · 原著改编资料`,
    scopeType: "manuscript", scopeId: manuscript.id, payload: { ...payload },
    sourceRefs: [{ type: "manuscript", id: manuscript.id, sourceHash: manuscript.sourceHash }],
  });
  const result = { deliverableId: deliverable.id, chunkCount: chunks.length };
  await hooks.persistArtifact("manuscript.dossier", manuscript.id, result);
  return result;
}
