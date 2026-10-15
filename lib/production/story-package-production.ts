import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { parseApprovedScreenplay } from "@/lib/novel/approved-screenplay-parser";
import { screenplayConversionSchema } from "@/lib/prompts/schemas";
import { StoryPackageSchema, StoryPackageFirstEpisodeSchema, type StoryPackage } from "./story-package-contract";
import { canonicalSceneDialogue } from "./story-quality-contract";

export function renderPackageScene(scene: StoryPackage["firstEpisode"]["scenes"][number]) {
  return [
    `场次 ${scene.sceneNumber}｜时长：${scene.durationSeconds}秒｜${scene.location}`,
    `人物：${scene.characters.join("、")}`, `道具：${scene.props.join("、")}`,
    `画面与动作：${scene.action}`, "对白/旁白：",
    ...scene.dialogue.map(line => `${line.speaker}：${line.line}`),
    `镜头：${scene.camera}`, `声音：${scene.sound}`,
  ].join("\n");
}

function renderLegacyPackageScene(scene: StoryPackage["firstEpisode"]["scenes"][number]) {
  return [
    `${scene.sceneNumber}. ${scene.heading}`, `时长：${scene.durationSeconds}秒`,
    `人物：${scene.characters.join("、")}`, `场景：${scene.location}`, `道具：${scene.props.join("、")}`,
    scene.action, ...scene.dialogue.map(line => `${line.speaker}：${line.line}`),
    `镜头：${scene.camera}`, `声音：${scene.sound}`, `场末状态：${scene.endState}`,
  ].join("\n");
}

/** Copy approved package material into the existing editors, without an LLM call. */
export async function seedPackageProduction(tx: Prisma.TransactionClient, input: {
  userId: string; projectId: string; episodeId: string; deliverableId: string; story: StoryPackage;
  episodeNumber?: number; allowWorkflowId?: string;
}) {
  const episode = await tx.episode.findFirst({
    where: { id: input.episodeId, projectId: input.projectId, project: { userId: input.userId } },
    include: { clips: true, storyboard: true, voiceLines: true },
  });
  const activeSource = episode?.activeSourceId ? await tx.episodeSourceVersion.findUnique({ where: { id: episode.activeSourceId } }) : null;
  const content = input.story.firstEpisode.scenes.map(renderPackageScene).join("\n\n");
  const legacyContent = input.story.firstEpisode.scenes.map(renderLegacyPackageScene).join("\n\n");
  const usesLegacyFormat = episode?.novelText === legacyContent;
  if (!episode || episode.episodeNumber !== (input.episodeNumber ?? 1) || (episode.novelText !== content && !usesLegacyFormat) ||
      !activeSource?.instructions?.startsWith(`策划包 ${input.deliverableId} `)) return false;
  // Partial or edited production work is authoritative; never graft a different source onto it.
  if (episode.clips.length || episode.storyboard || episode.voiceLines.length) return false;
  const active = await tx.workflowRun.count({ where: { episodeId: episode.id,
    ...(input.allowWorkflowId ? { id: { not: input.allowWorkflowId } } : {}),
    status: { in: ["queued", "running", "paused", "canceling"] } } });
  if (active) throw new Error("本集正在制作，请完成或取消任务后再同步策划内容");
  const storyboardId = randomUUID();
  await tx.storyboard.create({ data: { id: storyboardId, projectId: input.projectId,
    episodeId: episode.id, status: "director_review_required" } });
  let elapsed = 0, lineIndex = 0;
  for (const [clipIndex, scene] of input.story.firstEpisode.scenes.entries()) {
    const clipId = randomUUID(), panelId = randomUUID();
    const sceneText = renderPackageScene(scene);
    const sourceText = usesLegacyFormat ? renderLegacyPackageScene(scene) : sceneText;
    const parsed = parseApprovedScreenplay(sceneText)[0];
    const screenplay = screenplayConversionSchema.parse({ clipId, originalText: sourceText, scenes: [{
      sceneNumber: 0, heading: { intExt: /外景|\bEXT\b/i.test(scene.heading) ? "EXT" : parsed.intExt, location: scene.location, time: parsed.time },
      description: `镜头：${scene.camera}\n声音：${scene.sound}`, characters: scene.characters,
      content: [{ type: "action", text: scene.action }, ...parsed.lines.map(line =>
        line.kind === "voiceover" ? { type: "voiceover", character: line.character, text: line.text } :
          { type: "dialogue", character: line.character, parenthetical: line.parenthetical, lines: line.text })],
    }] });
    await tx.storyClip.create({ data: { id: clipId, projectId: input.projectId, episodeId: episode.id,
      clipIndex, summary: scene.heading, content: sourceText, screenplay: JSON.stringify(screenplay),
      charactersJson: JSON.stringify(scene.characters), locationsJson: JSON.stringify([scene.location]),
      propsJson: JSON.stringify(scene.props), status: "screenplay_ready", shotCount: 1 } });
    // A scene-level prompt is an editable draft, never an automatically approved shot plan.
    const dialogueLines = canonicalSceneDialogue(scene).map(line => ({ ...line, sourceId: line.id, id: randomUUID(),
      delivery: parsed.lines.find(parsedLine => parsedLine.text === line.content && (parsedLine.character ?? "旁白") === line.speaker)?.kind ?? "dialogue" }));
    const spokenLines = dialogueLines.filter(line => line.delivery === "dialogue");
    const dialogueSpeakers = [...new Set(spokenLines.map(line => line.speaker))];
    await tx.storyboardPanel.create({ data: { id: panelId, storyboardId, clipId, clipPanelIndex: 0,
      panelIndex: clipIndex, sceneNumber: scene.sceneNumber - 1, description: scene.action,
      cameraMove: scene.camera, locationName: scene.location, charactersJson: JSON.stringify(scene.characters),
      propsJson: JSON.stringify(scene.props), imagePrompt: scene.imagePrompt, videoPrompt: scene.videoPrompt,
      durationSeconds: scene.durationSeconds, srtStart: elapsed, srtEnd: elapsed + scene.durationSeconds,
      speakingCharacter: dialogueSpeakers.length === 1 ? dialogueSpeakers[0] : null,
      lipSyncText: dialogueSpeakers.length === 1 ? spokenLines.map(line => line.content).join("\n") : null,
      voiceoverText: dialogueLines.filter(line => line.delivery === "voiceover").map(line => line.content).join("\n") || null,
      subtitleText: scene.dialogue.map(line => `${line.speaker}：${line.line}`).join("\n"),
      endStateJson: JSON.stringify(scene.continuity?.endState ?? { body: scene.endState }),
      startStateJson: scene.productionDesign ? JSON.stringify(scene.productionDesign.startState) : null,
      motionBeatsJson: scene.productionDesign ? JSON.stringify(scene.productionDesign.motionBeats) : null,
      actingNotesJson: scene.productionDesign ? JSON.stringify({ characters: scene.productionDesign.acting }) : null,
      photographyRules: scene.productionDesign ? JSON.stringify(scene.productionDesign.photography) : null,
      vfxCuesJson: scene.productionDesign ? JSON.stringify(scene.productionDesign.vfxCues) : null,
      sfxCuesJson: scene.productionDesign ? JSON.stringify(scene.productionDesign.sfxCues) : null,
      sourceEvidenceJson: JSON.stringify([sourceText]),
      worldContextJson: JSON.stringify({ source: "story-package", deliverableId: input.deliverableId,
        ...scene.productionDesign?.worldContext,
        sceneNumber: scene.sceneNumber, imageReferenceSlots: scene.imageReferenceSlots,
        dialogueLedger: dialogueLines,
        continuityTransitions: scene.continuity?.transitions ?? [], keyframeMoment: "start",
        referenceScopes: scene.imageReferenceSlots.map(slot => ({ assetName: slot.name,
          inherit: ["已确认的资产外观设定"], exclude: ["参考图中的临时姿态和动作"] })) }), status: "draft" } });
    for (const line of dialogueLines) {
      const speaker = line.speaker;
      await tx.voiceLine.create({ data: { id: line.id, episodeId: episode.id, lineIndex: lineIndex++,
        speaker, content: line.content, delivery: line.delivery, matchedPanelId: panelId,
        voiceProfilePrompt: input.story.characters.find(character => character.name === speaker)?.voiceStyle || null } });
    }
    elapsed += scene.durationSeconds;
  }
  return true;
}

/** Retrofit packages adopted before structured production was connected. */
export async function syncAdoptedPackageProduction(input: { userId: string; projectId: string; episodeId: string }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
    const source = await tx.episode.findFirst({ where: { id: input.episodeId, projectId: input.projectId,
      project: { userId: input.userId } }, select: { activeSourceId: true, episodeNumber: true } });
    const activeSource = source?.activeSourceId ? await tx.episodeSourceVersion.findUnique({ where: { id: source.activeSourceId } }) : null;
    const deliverableId = activeSource?.instructions?.match(/^策划包 (\S+) v\d+(?:；原创续写 \S+)?$/)?.[1];
    if (!deliverableId) return { synced: false };
    const row = await tx.productionDeliverable.findFirst({ where: { id: deliverableId,
      projectId: input.projectId, userId: input.userId, status: { in: ["approved", "locked"] }, supersededAt: null } });
    const payload = row?.payload as Record<string, Prisma.JsonValue> | undefined;
    if (!payload?.adoption || payload.packageFormat !== "cyanyi-story-package-v1") return { synced: false };
    const story = StoryPackageSchema.parse(payload.storyPackage);
    if (source && source.episodeNumber > 1 && activeSource?.instructions?.includes("；原创续写 ")) {
      const trace = activeSource.promptTrace as Record<string, unknown> | null;
      const continued = StoryPackageFirstEpisodeSchema.shape.firstEpisode.safeParse(trace?.episode);
      if (!continued.success) return { synced: false };
      story.firstEpisode = continued.data;
    }
    return { synced: await seedPackageProduction(tx, { ...input, deliverableId,
      episodeNumber: source?.episodeNumber, story }) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    } catch (error) {
      if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") continue;
      throw error;
    }
  }
}
