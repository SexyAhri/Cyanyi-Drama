import { ArrowRight, Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStageCopy } from "../i18n";
import type { StudioLocale, StudioStageId } from "../types";

const flow: StudioStageId[] = [
  "writing",
  "assets",
  "storyboard",
  "shots",
  "audio",
  "delivery",
];
const descriptions = {
  "zh-CN": {
    writing: "确认生效剧本，保持事件和台词完整。",
    assets: "先确认人物、场景和道具形象，再进入镜头生产。",
    storyboard: "导演设计镜头，独立审核连续性，按问题定向修复。",
    shots: "先确认首帧，再从首帧生成连续动作；检查结果后选定版本。",
    audio: "绑定正确说话人，制作配音，再按选定画面处理口型。",
    delivery: "核对画面、声音和镜间衔接，预览后输出成片。",
  },
  en: {
    writing: "Confirm the active script and preserve events and dialogue.",
    assets: "Confirm characters, locations and props before shot production.",
    storyboard:
      "Design shots, independently review continuity and repair specific findings.",
    shots:
      "Confirm the first frame, generate continuous motion and select the accepted take.",
    audio:
      "Bind speakers, produce voices and apply lip sync to the selected footage.",
    delivery: "Check visual and audio continuity, preview and export.",
  },
};

export function DirectorWorkflowBar({
  stage,
  locale,
  onSelect,
  compact = false,
}: {
  compact?: boolean;
  stage: StudioStageId;
  locale: StudioLocale;
  onSelect: (stage: StudioStageId) => void;
}) {
  const next = flow[flow.indexOf(stage) + 1];
  return (
    <div className={compact ? "ml-auto flex min-w-0 flex-1 flex-wrap items-center gap-2 pl-2" : "flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/20 px-4 py-2"}>
      {!compact && <Clapperboard className="size-4 shrink-0 text-muted-foreground" />}
      <p className={compact ? "hidden min-w-0 flex-1 text-xs leading-5 text-muted-foreground 2xl:block" : "min-w-0 flex-1 text-xs leading-5 text-muted-foreground"}>
        {descriptions[locale][stage]}
      </p>
      {next ? (
        <Button size="sm" variant="ghost" onClick={() => onSelect(next)}>
          {locale === "zh-CN" ? "下一阶段：" : "Next: "}
          {getStageCopy(locale, next).short}
          <ArrowRight className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
