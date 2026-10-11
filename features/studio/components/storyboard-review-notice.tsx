import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { StudioLocale } from "../types";

export function StoryboardReviewNotice({ projectId, episodeId, locale }: {
  projectId: string; episodeId: string; locale: StudioLocale;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b py-3 text-sm">
      <p className="min-w-0 flex-1 text-muted-foreground">
        {locale === "en" ? "Existing prompts and dialogue are available. Review and confirm the storyboard draft before continuing production."
          : "已有提示词与台词可直接查看和编辑。当前分镜草案待确认，请先检查镜头拆分、时长和连续性，再继续制作。"}
      </p>
      <Button nativeButton={false} size="sm" variant="outline" render={<Link href={`/projects/${encodeURIComponent(projectId)}?episode=${encodeURIComponent(episodeId)}&stage=storyboard`} />}>
        {locale === "en" ? "Review storyboard" : "去确认分镜"}
      </Button>
    </div>
  );
}
