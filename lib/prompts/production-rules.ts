import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RenderedPrompt } from "./types";

export type ProductionPromptTask =
  | "storyboard-generation"
  | "storyboard-review"
  | "storyboard-repair"
  | "video-prompt-generation"
  | "asset-prompt-generation"
  | "script-generation";

export function readProductionTemplate(task: ProductionPromptTask) {
  return readFileSync(
    join(process.cwd(), "lib/prompts/production", `${task}.md`),
    "utf8",
  )
    .replace(/\r\n/g, "\n")
    .trim();
}

export function withProductionRules(
  prompt: RenderedPrompt,
  task: ProductionPromptTask,
) {
  const source = readProductionTemplate(task);
  let rules = source.split("## 输出契约")[0];
  if (task === "video-prompt-generation") {
    // H3 private syntax must not reach generic video models.
    rules = rules.split("## MiniMax H3 模式映射")[0];
  }
  if (task === "script-generation") rules = rules.split("## 正文格式")[0];
  const text = `${rules}\n\n## 当前平台适配契约\n下文的字段、音频模式、引用编号和输出契约是本次任务的权威要求；不得输出契约以外的字段或虚构模型能力。\n\n${prompt.text}`;
  const hash = createHash("sha256")
    .update(`${prompt.versionHash}\0${source}\0production-rules-v1`)
    .digest("hex");
  return { ...prompt, text, versionHash: hash,
    platformContract: [prompt.platformContract, rules].filter(Boolean).join("\n\n") };
}
