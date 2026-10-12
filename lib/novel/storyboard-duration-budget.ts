import { directorSpeechTiming, type DirectorScene, type DirectorShot } from "./storyboard-scene-contract";

/** Allocate whole seconds while reserving exact speech; actions may share spoken shots. */
export function allocateStoryboardDuration(scenes: DirectorScene[], target?: number) {
  if (!target || !Number.isFinite(target) || target <= 0 || !scenes.length) return null;
  const minimums = scenes.map(scene => Math.max(1, directorSpeechTiming(scene).reduce(
    (sum, line) => sum + line.suggested_fragments.reduce((seconds, fragment) => seconds + fragment.minimum_seconds, 0), 0,
  )));
  const minimum = minimums.reduce((sum, value) => sum + value, 0);
  const budget = Math.floor(target);
  if (minimum > budget) throw new Error(
    `本集原文对白的最低分镜时长约 ${minimum} 秒，超过目标 ${budget} 秒。请先精简剧本或提高目标时长，再拆镜；不能通过加速或删除原文对白满足预算。`,
  );
  const remaining = budget - minimum;
  const weights = scenes.map(scene => Math.max(1, scene.units.length));
  const weight = weights.reduce((sum, value) => sum + value, 0);
  const extras = weights.map(value => remaining * value / weight);
  const allocated = minimums.map((value, index) => value + Math.floor(extras[index]));
  let residue = budget - allocated.reduce((sum, value) => sum + value, 0);
  const order = extras.map((value, index) => ({ index, fraction: value % 1 })).sort((a, b) => b.fraction - a.fraction);
  for (const { index } of order) if (residue-- > 0) allocated[index]++;
  return { targetSeconds: budget, minimumSeconds: minimum, scenes: scenes.map((scene, index) => ({
    sceneId: scene.id, maximumSeconds: allocated[index], minimumSpeechSeconds: minimums[index],
  })) };
}

export function validateStoryboardDuration(shots: DirectorShot[], maximum?: number) {
  const actual = shots.reduce((sum, shot) => sum + shot.duration_seconds, 0);
  return maximum !== undefined && actual > maximum + 0.001
    ? [`Scene duration ${actual}s exceeds its ${maximum}s budget. Combine compatible action/reaction with speech, preserving every source unit and exact dialogue; do not accelerate speech.`]
    : [];
}
