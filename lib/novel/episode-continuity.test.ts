import { beforeEach, describe, expect, it, vi } from "vitest";

const episodeFindFirst = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/prisma", () => ({
  prisma: { episode: { findFirst: episodeFindFirst } },
}));

import { loadPreviousEpisodeHandoff } from "./episode-continuity";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("previous episode handoff", () => {
  it("combines the final screenplay scene and final storyboard state", async () => {
    episodeFindFirst.mockResolvedValue({
      id: "episode-1",
      episodeNumber: 1,
      name: "第一集",
      description: "韩宇得知母亲仍在人世。",
      clips: [
        {
          screenplay: JSON.stringify({
            scenes: [
              {
                heading: { intExt: "INT", location: "卧房", time: "夜" },
                description: "灯火摇曳。",
                characters: ["韩宇", "韩子枫"],
                content: [
                  { type: "action", text: "韩宇接过无字典籍。" },
                  { type: "dialogue", character: "韩宇", lines: "阴阳之境！" },
                ],
              },
            ],
          }),
        },
      ],
      storyboard: {
        panels: [
          {
            panelIndex: 12,
            description: "韩宇震惊地看向父亲。",
            locationName: "卧房",
            charactersJson: '["韩宇","韩子枫"]',
            propsJson: '["无字典籍"]',
            endStateJson: '{"heldBy":"韩宇","injury":"韩子枫重伤"}',
            worldContextJson: '{"time":"深冬夜晚"}',
          },
        ],
      },
    });

    const handoff = await loadPreviousEpisodeHandoff("project-1", 2);

    expect(handoff).toEqual(
      expect.objectContaining({
        episodeNumber: 1,
        finalScene: expect.objectContaining({
          characters: ["韩宇", "韩子枫"],
          recentContent: expect.arrayContaining([
            expect.objectContaining({ text: "韩宇接过无字典籍。" }),
          ]),
        }),
        finalPanel: expect.objectContaining({
          locationName: "卧房",
          props: ["无字典籍"],
          endState: { heldBy: "韩宇", injury: "韩子枫重伤" },
        }),
      }),
    );
  });

  it("returns null for the first episode", async () => {
    episodeFindFirst.mockResolvedValue(null);
    await expect(
      loadPreviousEpisodeHandoff("project-1", 1),
    ).resolves.toBeNull();
  });
});
