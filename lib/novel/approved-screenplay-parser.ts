export type ApprovedScreenplayLine = {
  character: string | null;
  kind: "dialogue" | "voiceover";
  parenthetical: string | null;
  text: string;
};

export type ApprovedScreenplayScene = {
  sourceText: string;
  durationSeconds: number | null;
  intExt: "INT" | "EXT";
  location: string;
  time: string;
  action: string;
  camera: string;
  sound: string;
  visualEffects: string;
  lines: ApprovedScreenplayLine[];
};

export type ApprovedScreenplayCanonicalContext = {
  characters: string[];
  locations: string[];
};

const SCENE_HEADER =
  /^\s*(?:#{1,6}\s*)?(?:\*{1,2}|_{1,2})?\s*(?:场次|场景|scene)\s*[\d一二三四五六七八九十百零]*\s*(?:[｜|].*?)?\s*(?:\*{1,2}|_{1,2})?\s*$/gimu;

const FIELD_LABELS = new Map<string, keyof SceneFields>([
  ["画面与动作", "action"],
  ["画面动作", "action"],
  ["动作", "action"],
  ["visual and action", "action"],
  ["visual/action", "action"],
  ["action", "action"],
  ["镜头表达", "camera"],
  ["镜头", "camera"],
  ["camera", "camera"],
  ["shot", "camera"],
  ["对白/旁白", "spoken"],
  ["对白与旁白", "spoken"],
  ["对白", "spoken"],
  ["dialogue/narration", "spoken"],
  ["dialogue", "spoken"],
  ["声音与氛围", "sound"],
  ["声音/氛围", "sound"],
  ["声音", "sound"],
  ["sound and atmosphere", "sound"],
  ["sound", "sound"],
  ["特效", "visualEffects"],
  ["视觉特效", "visualEffects"],
  ["vfx", "visualEffects"],
]);

type SceneFields = {
  action: string[];
  camera: string[];
  spoken: string[];
  sound: string[];
  visualEffects: string[];
};

export function splitApprovedScreenplayScenes(sourceText: string) {
  const matches = [...sourceText.matchAll(SCENE_HEADER)];
  if (!matches.length) return [sourceText];
  return matches.map((match, index) => {
    const start = index === 0 ? 0 : match.index;
    const end = matches[index + 1]?.index ?? sourceText.length;
    return sourceText.slice(start, end);
  });
}

export function parseApprovedScreenplay(
  sourceText: string,
): ApprovedScreenplayScene[] {
  return splitApprovedScreenplayScenes(sourceText).map(parseScene);
}

export function organizeApprovedScreenplayClip(
  clipId: string,
  sourceText: string,
  canonical: ApprovedScreenplayCanonicalContext,
) {
  const parsedScenes = parseApprovedScreenplay(sourceText);
  const scenes = parsedScenes.map((scene) => {
    const location =
      scene.location === "未指定场景"
        ? canonical.locations.find((name) => scene.sourceText.includes(name)) ??
          canonical.locations[0] ??
          scene.location
        : scene.location;
    const characters = canonical.characters.filter((name) =>
      scene.sourceText.includes(name),
    );
    return {
      heading: {
        intExt: scene.intExt,
        location,
        time: scene.time,
      },
      description: [
        scene.camera ? `镜头表达：${scene.camera}` : "",
        scene.sound ? `声音与氛围：${scene.sound}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      characters,
      beats: [{ text: scene.action }],
    };
  });
  const dialogue = parsedScenes.flatMap((scene, sceneIndex) =>
    scene.lines.flatMap((line) =>
      line.kind === "dialogue" && line.character
        ? [
            {
              sceneIndex,
              afterBeatIndex: 0,
              character: line.character,
              parenthetical: line.parenthetical,
              lines: line.text,
            },
          ]
        : [],
    ),
  );
  const narration = parsedScenes.flatMap((scene, sceneIndex) =>
    scene.lines.flatMap((line) =>
      line.kind === "voiceover"
        ? [
            {
              sceneIndex,
              afterBeatIndex: 0,
              character: line.character,
              text: line.text,
            },
          ]
        : [],
    ),
  );
  const effects = parsedScenes.flatMap((scene, sceneIndex) => {
    if (!scene.visualEffects && !scene.sound) return [];
    return [
      {
        sceneIndex,
        beatIndex: 0,
        actionDesign: {
          kind: "phenomenon" as const,
          performer: scenes[sceneIndex].characters[0] ?? "环境",
          target: null,
          realm: null,
          technique: null,
          visualMotif: scene.visualEffects || null,
          visualMotifSource: scene.visualEffects
            ? ("production_inference" as const)
            : null,
          visualMotifRationale: null,
          choreography: [scene.action],
          impact: null,
          environmentResponse: null,
          vfxPlan: scene.visualEffects
            ? [
                {
                  phase: "release" as const,
                  category: "environment_interaction" as const,
                  description: scene.visualEffects,
                },
              ]
            : [],
          sfxPlan: scene.sound
            ? [
                {
                  phase: "release" as const,
                  type: "environment" as const,
                  description: scene.sound,
                },
              ]
            : [],
          evidence: [scene.action],
        },
      },
    ];
  });
  return {
    beats: { clipId, scenes },
    dialogue: { clipId, lines: dialogue },
    narration: { clipId, lines: narration },
    effects: { clipId, designs: effects },
  };
}

function parseScene(sourceText: string): ApprovedScreenplayScene {
  const header = sourceText.match(SCENE_HEADER)?.[0]?.trim() ?? "";
  const fields = readFields(sourceText);
  const heading = parseHeading(header);
  const action = cleanField(fields.action.join("\n"));
  const camera = cleanField(fields.camera.join("\n"));
  const sound = cleanField(fields.sound.join("\n"));
  const visualEffects = cleanField(fields.visualEffects.join("\n"));
  return {
    sourceText,
    durationSeconds: parseDuration(header),
    intExt: heading.intExt,
    location: heading.location,
    time: heading.time,
    action: action || fallbackAction(sourceText, header),
    camera,
    sound,
    visualEffects,
    lines: parseSpokenLines(fields.spoken.join("\n")),
  };
}

function readFields(sourceText: string): SceneFields {
  const fields: SceneFields = {
    action: [],
    camera: [],
    spoken: [],
    sound: [],
    visualEffects: [],
  };
  let active: keyof SceneFields | null = null;
  for (const rawLine of sourceText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const labeled = line.match(/^([^:：]{1,40})\s*[:：]\s*(.*)$/u);
    const key = labeled ? FIELD_LABELS.get(normalizeLabel(labeled[1])) : null;
    if (key) {
      active = key;
      const inlineValue = cleanMarkdownWrap(labeled?.[2] ?? "");
      if (inlineValue) fields[key].push(inlineValue);
      continue;
    }
    if (active && line) fields[active].push(cleanMarkdownWrap(line));
  }
  return fields;
}

function parseSpokenLines(value: string): ApprovedScreenplayLine[] {
  if (!value.trim() || isNone(value)) return [];
  const candidates = value
    .replace(/；(?=\s*[^；：:]{1,40}[：:])/gu, "\n")
    .replace(
      /\s+(?=[^，。！？!?；;：:\n]{1,24}(?:[（(][^）)\n]{1,20}[）)])?\s*[：:])/gu,
      "\n",
    )
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const lines: ApprovedScreenplayLine[] = [];
  for (const candidate of candidates) {
    const match = candidate.match(/^([^:：]{1,40})\s*[:：]\s*(.+)$/u);
    if (!match) continue;
    const rawSpeaker = match[1].trim();
    const text = match[2].trim();
    if (!text || isNone(text) || FIELD_LABELS.has(normalizeLabel(rawSpeaker)))
      continue;
    if (/^(?:旁白|画外音|narrator|narration)$/iu.test(rawSpeaker)) {
      lines.push({
        character: null,
        kind: "voiceover",
        parenthetical: null,
        text,
      });
      continue;
    }
    const innerVoice =
      /(?:内心独白|内心|独白|心声|voiceover|voice over|inner monologue)/iu.test(
        rawSpeaker,
      );
    const parenthetical = rawSpeaker.match(/[（(]([^）)]+)[）)]/u)?.[1]?.trim() ?? null;
    const character = rawSpeaker
      .replace(/[（(][^）)]*[）)]/gu, "")
      .replace(/(?:内心独白|内心|独白|心声|voiceover|voice over|inner monologue)/giu, "")
      .trim();
    lines.push({
      character: character || null,
      kind: innerVoice ? "voiceover" : "dialogue",
      parenthetical,
      text,
    });
  }
  return lines;
}

function parseHeading(header: string) {
  const finalPart = cleanMarkdownWrap(
    header.split(/[｜|]/u).at(-1)?.trim() ?? "",
  );
  const tokens = finalPart.split(/[·•]/u).map((item) => item.trim()).filter(Boolean);
  const intExtToken = tokens[0] ?? "";
  const hasIntExt = /^(?:内景|外景|内|外|INT|EXT)$/iu.test(intExtToken);
  const location = (hasIntExt ? tokens[1] : tokens[0]) || "未指定场景";
  const time =
    (hasIntExt ? tokens.slice(2) : tokens.slice(1)).join("·") || "未指定时间";
  const intExt = /^(?:内景|内|INT)$/iu.test(intExtToken)
    ? "INT"
    : /^(?:外景|外|EXT)$/iu.test(intExtToken)
      ? "EXT"
      : inferInterior(location);
  return { intExt, location, time } as const;
}

function parseDuration(header: string) {
  const match = header.match(/(?:预计时长|时长|duration)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:秒|s(?:ec(?:onds?)?)?)/iu);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function fallbackAction(sourceText: string, header: string) {
  const body = header ? sourceText.slice(sourceText.indexOf(header) + header.length) : sourceText;
  const content = body
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^(?:\*{1,2}|_{1,2})?\s*(?:标题|梗概|正文|成片规格|核心剧情|全局视听规则)\s*[:：]/u.test(line),
    )
    .join("\n")
    .trim();
  return content || sourceText.trim();
}

function cleanField(value: string) {
  return isNone(value) ? "" : value.trim();
}

function isNone(value: string) {
  return /^(?:无|没有|不需要|none|n\/a)\s*[。.!]?$/iu.test(value.trim());
}

function normalizeLabel(value: string) {
  return cleanMarkdownWrap(value).toLowerCase().replace(/\s+/gu, " ");
}

function cleanMarkdownWrap(value: string) {
  return value
    .trim()
    .replace(/^(?:\*{1,2}|_{1,2})\s*|\s*(?:\*{1,2}|_{1,2})$/gu, "")
    .trim();
}

function inferInterior(location: string): "INT" | "EXT" {
  return /房|室|殿|厅|屋|洞|车内|office|room|hall|interior/iu.test(location)
    ? "INT"
    : "EXT";
}
