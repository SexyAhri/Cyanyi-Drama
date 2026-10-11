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
import { chunkSource, sourceFingerprint, type SourceTaskHooks } from "./long-source";
import { parseNovelStructure } from "./novel-volumes";

const entry = z.object({ name: z.string().min(1).max(60), details: z.string().min(1).max(160) });
export const ManuscriptNotesSchema = z.object({
  summary: z.string().min(1).max(1200),
  characters: z.array(entry).max(10), locations: z.array(entry).max(10), props: z.array(entry).max(10),
  rules: z.array(z.string().min(1).max(160)).max(8),
});
export type ManuscriptNotes = z.infer<typeof ManuscriptNotesSchema>;
export type ManuscriptDossier = {
  packageFormat: "cyanyi-manuscript-dossier-v1"; manuscriptId: string; sourceHash: string;
  title: string; summary: ManuscriptNotes;
  chapters: Array<{ heading: string; startIndex: number; endIndex: number }>;
  chunks: Array<{ index: number; start: number; end: number; artifactRef: string }>;
};

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
  async function extract(type: string, ref: string, text: string, merge = false) {
    await hooks.assertActive();
    const key = sourceFingerprint({ ref, text, model: input.model, channel: input.channelId, version: 1 });
    const cached = ManuscriptNotesSchema.safeParse(await hooks.loadArtifact(type, key));
    if (cached.success) return { notes: cached.data, artifactRef: key };
    const result = await requestOpenAiStructured({ ...provider, schema: ManuscriptNotesSchema,
      timeoutMs: 120_000, temperature: 0.2,
      prompt: renderPrompt({ id: PROMPT_IDS.STORY_PACKAGE_GENERATION, locale: input.locale, variables: {
        project_context: text, episode_count: "0", generation_task:
          `${merge ? "合并提供的原著摘要与资料" : "只提取本段原著中明确发生的事件及人物、场景、道具、世界规则"}。不得创作续篇、改写结局或编造未提供的信息。信息不明请说明。保留事件顺序、人物别名和限制条件；这是原著资料草稿，所有实体详情需有原文短引用作为依据。输出语言与原文一致。严格使用 JSON Schema：${JSON.stringify(z.toJSONSchema(ManuscriptNotesSchema))}`,
      } }),
    });
    await hooks.assertActive();
    await hooks.persistArtifact(type, key, result.data);
    await hooks.persistArtifact("prompt.trace", key, result.trace);
    return { notes: result.data, artifactRef: key };
  }
  const chunks: ManuscriptDossier["chunks"] = [];
  const chunkNotes: ManuscriptNotes[] = [];
  const sourceChunks = chunkSource(manuscript.sourceText);
  for (const chunk of sourceChunks) {
    await hooks.reportProgress?.(`正在提取原著资料 ${chunk.index + 1}/${sourceChunks.length}`);
    const result = await extract("manuscript.chunk", `${chunk.start}:${chunk.end}`, chunk.text);
    chunks.push({ index: chunk.index, start: chunk.start, end: chunk.end, artifactRef: result.artifactRef });
    chunkNotes.push(result.notes);
  }
  // Bounded hierarchical reduction; never send every chunk summary in one model request.
  let level = chunkNotes;
  let depth = 0;
  while (level.length > 1) {
    const next: ManuscriptNotes[] = [];
    for (let start = 0; start < level.length;) {
      const group: ManuscriptNotes[] = [level[start++]];
      while (start < level.length && group.length < 4 &&
        JSON.stringify([...group, level[start]]).length <= 12_000) group.push(level[start++]);
      // Each note is bounded by the schema. Pairwise merge guarantees reduction.
      if (group.length === 1 && start < level.length) group.push(level[start++]);
      await hooks.reportProgress?.(`正在合并原著资料，第 ${depth + 1} 层`);
      next.push(group.length === 1 ? group[0] : (await extract("manuscript.merge", `${depth}:${start}`, JSON.stringify(group), true)).notes);
    }
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
