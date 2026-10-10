// Dialogue remains in the voice-line record; provider text only controls visible performance.
export function lockSilentVideoPerformance(
  prompt: string,
  input: {
    speakingCharacter?: string | null;
    voiceoverText?: string | null;
    locale?: "zh" | "en";
  },
) {
  const en = input.locale === "en";
  const speaker = input.speakingCharacter?.trim();
  const lock = speaker
    ? en
      ? `Visible speech performance belongs only to ${speaker}; listeners respond with gaze, breathing and posture, without speaking mouth movements. Speech audio and precise lip sync are added in post.`
      : `画面中的说话表演只属于${speaker}；听者通过视线、呼吸和姿态回应，不做说话口型。录音和精确口型由后期加入。`
    : input.voiceoverText?.trim()
      ? en
        ? "The voiceover is off-screen: visible characters keep their lips closed while their expressions and body motion remain natural."
        : "本镜为画外音，画面人物保持闭口，通过表情与身体动作自然表演。"
      : "";
  const sound = en
    ? "Silent video; no generated dialogue, narration, subtitles or watermarks."
    : "生成无声画面，不生成对白、旁白、字幕或水印。";
  return [
    prompt.trim(),
    lock && !prompt.includes(lock) ? lock : "",
    !prompt.includes(sound) ? sound : "",
  ]
    .filter(Boolean)
    .join("\n");
}
