import { prisma } from "@/lib/server/prisma";

export type PreviousEpisodeHandoff = {
  episodeId: string;
  episodeNumber: number;
  episodeName: string;
  episodeSummary: string | null;
  finalScene: {
    heading: unknown;
    description: string | null;
    characters: string[];
    recentContent: unknown[];
  } | null;
  finalPanel: {
    panelIndex: number;
    description: string | null;
    locationName: string | null;
    characters: string[];
    props: string[];
    endState: unknown;
    worldContext: unknown;
  } | null;
};

export async function loadPreviousEpisodeHandoff(
  projectId: string,
  episodeNumber: number,
): Promise<PreviousEpisodeHandoff | null> {
  const previous = await prisma.episode.findFirst({
    where: { projectId, episodeNumber: { lt: episodeNumber } },
    orderBy: { episodeNumber: "desc" },
    select: {
      id: true,
      episodeNumber: true,
      name: true,
      description: true,
      clips: {
        where: { screenplay: { not: null } },
        orderBy: { clipIndex: "desc" },
        take: 1,
        select: { screenplay: true },
      },
      storyboard: {
        select: {
          panels: {
            orderBy: { panelIndex: "desc" },
            take: 1,
            select: {
              panelIndex: true,
              description: true,
              locationName: true,
              charactersJson: true,
              propsJson: true,
              endStateJson: true,
              worldContextJson: true,
            },
          },
        },
      },
    },
  });
  if (!previous) return null;

  const panel = previous.storyboard?.panels[0];
  return {
    episodeId: previous.id,
    episodeNumber: previous.episodeNumber,
    episodeName: previous.name,
    episodeSummary: compactText(previous.description, 800),
    finalScene: parseFinalScene(previous.clips?.[0]?.screenplay),
    finalPanel: panel
      ? {
          panelIndex: panel.panelIndex,
          description: compactText(panel.description, 800),
          locationName: panel.locationName,
          characters: parseStringArray(panel.charactersJson),
          props: parseStringArray(panel.propsJson),
          endState: compactValue(parseJson(panel.endStateJson, {})),
          worldContext: compactValue(parseJson(panel.worldContextJson, {})),
        }
      : null,
  };
}

function parseFinalScene(value: string | null | undefined) {
  const screenplay = parseJson<Record<string, unknown>>(value, {});
  const scenes = Array.isArray(screenplay.scenes) ? screenplay.scenes : [];
  const scene = scenes.at(-1);
  if (!isRecord(scene)) return null;
  const content = Array.isArray(scene.content) ? scene.content : [];
  return {
    heading: compactValue(scene.heading ?? null),
    description: compactText(scene.description, 800),
    characters: stringArray(scene.characters),
    recentContent: content.slice(-6).map((item) => compactValue(item)),
  };
}

function compactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return compactText(value, 400);
  if (typeof value === "number" || typeof value === "boolean" || value == null)
    return value;
  if (depth >= 3) return null;
  if (Array.isArray(value))
    return value.slice(0, 12).map((item) => compactValue(item, depth + 1));
  if (!isRecord(value)) return null;
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 20)
      .map(([key, item]) => [key, compactValue(item, depth + 1)]),
  );
}

function compactText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function parseStringArray(value: string | null) {
  return stringArray(parseJson(value, []));
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 30)
    : [];
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
