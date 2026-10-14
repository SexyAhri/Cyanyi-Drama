export const CAPABILITY_BILLING_UNITS: Record<string, readonly string[]> = {
  text: ["request", "character", "1k_character"],
  image: ["request", "image"],
  video: ["request", "second", "minute"],
  audio: ["request", "second", "minute", "character", "1k_character"],
  lipsync: ["request", "second", "minute"],
  voicedesign: ["request", "second", "minute", "character", "1k_character"],
};

