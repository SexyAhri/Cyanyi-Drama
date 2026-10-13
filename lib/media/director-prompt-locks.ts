export type VideoSpeechLine = {
  speaker: string;
  content: string;
  delivery: string;
};

/** Compile approved sound without inventing spoken story text. */
export function lockVideoAudioPerformance(
  prompt: string,
  input: {
    speakingCharacter?: string | null;
    lipSyncText?: string | null;
    voiceoverText?: string | null;
    voiceoverCharacter?: string | null;
    voiceLines?: readonly VideoSpeechLine[];
    locale?: "zh" | "en";
  } = {},
) {
  const en = input.locale === "en";
  const lines = [...(input.voiceLines ?? [])];
  const dialogue = input.lipSyncText;
  const voiceover = input.voiceoverText;
  const covered = (text: string, isDialogue: boolean) =>
    lines.some((line) => line.content.trim() === text.trim()) ||
    lines.filter((line) => (line.delivery === "dialogue") === isDialogue)
      .map((line) => line.content).join("").replace(/\s/gu, "") === text.replace(/\s/gu, "");
  if (dialogue?.trim() && !covered(dialogue, true))
    lines.push({
      speaker: input.speakingCharacter?.trim() || (en ? "Speaker" : "说话角色"),
      content: dialogue,
      delivery: "dialogue",
    });
  if (voiceover?.trim() && !covered(voiceover, false))
    lines.push({
      speaker: input.voiceoverCharacter?.trim() || (en ? "Voiceover" : "画外音"),
      content: voiceover,
      delivery: input.voiceoverCharacter ? "inner_monologue" : "voiceover",
    });
  const sound = en
    ? "Generate a complete audiovisual clip: include the approved dialogue, off-screen narration and inner monologue, synchronized environmental sound and action effects. Keep voices intelligible, character voices consistent and sound continuous; include music only when specified. Do not invent or rewrite speech. No generated subtitles, captions, titles or watermarks; subtitles are composed later."
    : "生成完整声画视频：包含本镜已有的对白、画外音、旁白、心声，以及与场景和动作同步的环境声、音效；人声清晰，角色音色一致，声音连续，配乐仅按已有设计生成。不得新增、改写台词。不生成字幕、标题或水印，字幕由项目后期合成。";
  const spoken = lines.filter((line) => line.content.trim()).map((line) => {
    const text = `“${line.content}”`;
    if (line.delivery === "dialogue")
      return en
        ? `${line.speaker} speaks the original dialogue exactly once: ${text}. Synchronize their mouth movements to their voice; listeners react without speaking.`
        : `${line.speaker}逐字说出原文对白一次：${text}。该角色口型与发声同步，其他人物倾听或回应，不做说话口型。`;
    const inner = line.delivery === "inner_monologue";
    return en
      ? `${line.speaker} delivers ${inner ? "inner monologue" : "off-screen narration"} exactly once: ${text}. This is off-screen audio, not visible speech; visible characters do not lip-sync to it.`
      : `${line.speaker}以${inner ? "心声／内心独白" : "画外音／旁白"}逐字朗读原文一次：${text}。声音来自画外，画面人物不对这段声音做口型，自然保持表情与身体动作。`;
  });
  const sanitized = removeLegacySilentVideoInstructions(prompt);
  const contract = /(?:\n|^)(?:【声音与台词】|\[Sound and speech\])\n[\s\S]*?(?:【声音与台词结束】|\[End sound and speech\])/gu;
  // Standalone canvas nodes may only carry their previously compiled prompt.
  if (!lines.length && sanitized.match(contract)) return sanitized;
  const base = sanitized.replace(contract, "").trim();
  return [
    base,
    en ? "[Sound and speech]" : "【声音与台词】",
    ...spoken,
    sound,
    en ? "[End sound and speech]" : "【声音与台词结束】",
  ].filter(Boolean).join("\n");
}

/** Remove old generation policy while preserving actions and quoted speech. */
export function removeLegacySilentVideoInstructions(prompt: string) {
  return prompt.split(/(“[^”]*”|<d>[\s\S]*?<\/d>|"[^"\n]*")/gu).map((part, index) => {
    if (index % 2) return part;
    return part
      .replace(/生成无声画面，不生成对白、旁白、字幕或水印。[\t ]*/gu, "")
      .replace(/(?:仅生成静音视频|输出无声画面|视频保持无声|不生成可辨识人声|不生成对白[、，]旁白)[。；;，,]?/gu, "")
      .replace(/(?:录音和精确口型(?:由后期加入|在后期加入)|声音和精确口型由后期处理)[。；;，,]?/gu, "")
      .replace(/Silent video; no generated dialogue, narration, subtitles or watermarks\./giu, "")
      .replace(/(?:Silent footage;|Keep footage silent;|The recorded voice and precise lip sync are added later\.|Speech audio and precise lip sync are added in post\.)/giu, "");
  }).join("").trim();
}
