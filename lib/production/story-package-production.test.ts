import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { renderPackageScene, seedPackageProduction } from "./story-package-production";
import { makePackage } from "./story-package-test-fixture";

describe("adopted story dialogue and boundary state mapping", () => {
  it("uses the same ordered IDs for voice lines, subtitles and the panel ledger", async () => {
    const story = makePackage();
    story.firstEpisode.scenes = story.firstEpisode.scenes.slice(0, 1);
    const scene = story.firstEpisode.scenes[0];
    scene.dialogue = [{ speaker: "阿青", line: "先查这一处。" }, { speaker: "老周", line: "好，慢点。" }];
    scene.characters = ["阿青", "老周"];
    const panelCreate = vi.fn(), voiceCreate = vi.fn();
    const tx = {
      episode: { findFirst: vi.fn().mockResolvedValue({ id: "episode", episodeNumber: 1, activeSourceId: "source", novelText: renderPackageScene(scene), clips: [], storyboard: null, voiceLines: [] }) },
      episodeSourceVersion: { findUnique: vi.fn().mockResolvedValue({ instructions: "策划包 package v1" }) },
      workflowRun: { count: vi.fn().mockResolvedValue(0) },
      storyboard: { create: vi.fn() }, storyClip: { create: vi.fn() },
      storyboardPanel: { create: panelCreate }, voiceLine: { create: voiceCreate },
    } as unknown as Prisma.TransactionClient;
    expect(await seedPackageProduction(tx, { userId: "user", projectId: "project", episodeId: "episode", deliverableId: "package", story })).toBe(true);
    const data = panelCreate.mock.calls[0][0].data;
    const lines = voiceCreate.mock.calls.map(([arg]) => arg.data);
    const ledger = JSON.parse(data.worldContextJson).dialogueLedger;
    expect(ledger.map((line: { id: string }) => line.id)).toEqual(lines.map(line => line.id));
    expect(ledger.map((line: { sourceId: string }) => line.sourceId)).toEqual(["scene-1-line-1", "scene-1-line-2"]);
    expect(lines.map(line => [line.lineIndex, line.speaker, line.content])).toEqual([[0, "阿青", "先查这一处。"], [1, "老周", "好，慢点。"]]);
    expect(data.subtitleText).toBe("阿青：先查这一处。\n老周：好，慢点。");
    expect(data.speakingCharacter).toBeNull();
    expect(data.lipSyncText).toBeNull();
    expect(JSON.parse(data.startStateJson)).toEqual(scene.continuity!.startState);
    expect(JSON.parse(data.endStateJson)).toEqual(scene.continuity!.endState);
    expect(JSON.parse(data.worldContextJson).continuityTransitions).toEqual(scene.continuity!.transitions);
  });
});
