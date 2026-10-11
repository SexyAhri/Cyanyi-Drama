"use client";

import { Check, Copy, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type { StoryPackage } from "@/lib/production/story-package-contract";

import type { StudioLocale } from "../types";

export function StoryPackageReviewDialog({
  projectId,
  deliverableId,
  onAdopted,
  deliverableTitle,
  locale,
  initialTab = "overview",
  onOpenChange,
  open,
  storyPackage,
  status,
  version,
}: {
  projectId?: string;
  deliverableId?: string;
  onAdopted?: () => Promise<unknown> | void;
  deliverableTitle: string;
  locale: StudioLocale;
  initialTab?:
    | "overview"
    | "outline"
    | "characters"
    | "locations"
    | "props"
    | "episode"
    | "prompts";
  onOpenChange: (open: boolean) => void;
  open: boolean;
  storyPackage: StoryPackage;
  status: string;
  version: number;
}) {
  const [adopting, setAdopting] = useState(false);
  const [adopted, setAdopted] = useState(false);
  const en = locale === "en";
  const t = (zh: string, english: string) => (en ? english : zh);
  async function adopt() {
    if (!projectId || !deliverableId || adopting) return;
    setAdopting(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/story-package/adopt`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deliverableId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "采用失败");
      setAdopted(true);
      toast.success(t("策划包已采用，剧集与资产已同步。已有正文保留，新正文可在版本中选择。", "Package adopted. Episodes and assets are synced; existing scripts are preserved."));
      await onAdopted?.();
    } catch (error) { toast.error(error instanceof Error ? error.message : t("采用失败", "Adoption failed")); }
    finally { setAdopting(false); }
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[min(90dvh,900px)] max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4">
          <div className="flex min-w-0 items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle className="truncate">{deliverableTitle}</DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {storyPackage.format.episodeCount} {t("集 ·", "episodes ·")} {storyPackage.format.structure} · {storyPackage.format.aspectRatio}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              <Badge variant="secondary">
                {status === "draft" ? t("草稿 · 待审核", "Draft · needs review") : status}
              </Badge>
              <Badge variant="outline">v{version}</Badge>
            </div>
          </div>
        </DialogHeader>
        <Tabs className="flex min-h-0 flex-1 flex-col" defaultValue={initialTab}>
          <TabsList className="mx-4 mt-3 h-auto shrink-0 justify-start gap-1 overflow-x-auto bg-transparent p-0" variant="line">
            <TabsTrigger value="overview">{t("策划总览", "Overview")}</TabsTrigger>
            <TabsTrigger value="outline">{t("故事大纲", "Story outline")}</TabsTrigger>
            <TabsTrigger value="characters">{t("人物传记", "Characters")}</TabsTrigger>
            <TabsTrigger value="locations">{t("场景设计", "Locations")}</TabsTrigger>
            <TabsTrigger value="props">{t("道具设计", "Props")}</TabsTrigger>
            <TabsTrigger value="episode">{t("第 1 集正文", "Episode 1")}</TabsTrigger>
            <TabsTrigger value="prompts">{t("图片与视频提示词", "Image & video prompts")}</TabsTrigger>
          </TabsList>
          <TabsContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 data-hidden:hidden" value="overview">
            <div className="mx-auto max-w-4xl space-y-5">
              <section>
                <SectionTitle>{t("一句话故事", "Logline")}</SectionTitle>
                <p className="mt-2 rounded-xl border bg-muted/20 p-4 text-sm leading-7">{storyPackage.logline}</p>
              </section>
              <section>
                <SectionTitle>{t("故事梗概", "Series synopsis")}</SectionTitle>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{storyPackage.synopsis}</p>
              </section>
              <section>
                <SectionTitle>{t("核心看点", "Core appeals")}</SectionTitle>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {storyPackage.coreAppeal.map((item, index) => (
                    <li className="rounded-xl border px-3 py-2.5 text-sm leading-6" key={`${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              </section>
              <section>
                <SectionTitle>{t("世界规则", "World rules")}</SectionTitle>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {storyPackage.worldRules.map((item, index) => (
                    <article className="rounded-xl border p-3" key={`${index}-${item.rule}`}>
                      <p className="text-sm font-medium">{item.rule}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.consequence}</p>
                    </article>
                  ))}
                </div>
              </section>
              <section>
                <SectionTitle>{t("创作禁区", "Creative prohibitions")}</SectionTitle>
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6 text-muted-foreground">
                  {storyPackage.creativeProhibitions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                </ul>
              </section>
            </div>
          </TabsContent>
          <TabsContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 data-hidden:hidden" value="outline">
            <div className="mx-auto max-w-4xl space-y-5">
              <section>
                <SectionTitle>{t("一句话故事", "Logline")}</SectionTitle>
                <p className="mt-2 rounded-xl border bg-muted/20 p-4 text-sm leading-7">{storyPackage.logline}</p>
              </section>
              <section>
                <SectionTitle>{t("全剧梗概", "Series synopsis")}</SectionTitle>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{storyPackage.synopsis}</p>
              </section>
              <section>
                <SectionTitle>{t("分卷大纲", "Volume outlines")}</SectionTitle>
                <div className="mt-2 grid gap-3">
                  {storyPackage.volumes.map((volume) => (
                    <article className="rounded-xl border p-4" key={volume.volume}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{t("第", "Vol. ")}{volume.volume}{en ? "" : " 卷"}</Badge>
                        <span className="font-medium">{volume.title}</span>
                        <span className="text-xs text-muted-foreground">{volume.episodeRange}</span>
                      </div>
                      <p className="mt-3 text-sm leading-6">{volume.synopsis}</p>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("卷尾高潮：", "Climax: ")}{volume.climax}</p>
                      <p className="text-xs leading-5 text-muted-foreground">{t("卷尾钩子：", "Ending hook: ")}{volume.endingHook}</p>
                    </article>
                  ))}
                </div>
              </section>
              <section>
                <SectionTitle>{t("逐集大纲", "Episode outlines")}</SectionTitle>
                <div className="mt-2 divide-y rounded-xl border">
                  {storyPackage.episodeOutlines.map((episode) => (
                    <article className="p-3" key={episode.episodeNumber}>
                      <h3 className="text-sm font-semibold">{t("第", "Episode ")}{episode.episodeNumber}{en ? ": " : " 集 · "}{episode.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{episode.summary}</p>
                      <div className="mt-2 grid gap-x-4 gap-y-1 text-xs leading-5 sm:grid-cols-2">
                        <p><span className="font-medium text-foreground">{t("集尾钩子：", "Hook: ")}</span>{episode.endingHook}</p>
                        <p><span className="font-medium text-foreground">{t("伏笔：", "Clue: ")}</span>{episode.plantedClue}</p>
                        <p className="sm:col-span-2"><span className="font-medium text-foreground">{t("回收：", "Payoff: ")}</span>{episode.payoff}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
              <section className="grid gap-4 sm:grid-cols-3">
                <StoryTable title={t("钩子", "Hooks")} rows={storyPackage.hooks.map((item) => `${t("第", "Ep. ")}${item.episodeNumber}${en ? "" : " 集"}：${item.hook} → ${item.promisedPayoff}`)} />
                <StoryTable title={t("伏笔与回收", "Foreshadowing") } rows={storyPackage.foreshadowing.map((item) => `${item.clue}：${item.introducedAt} → ${item.payoffAt}，${item.payoff}`)} />
                <StoryTable title={t("反转", "Reversals")} rows={storyPackage.reversals.map((item) => `${t("第", "Ep. ")}${item.episodeNumber}${en ? ": " : " 集："}${item.reveal}（${item.setup}）`)} />
              </section>
            </div>
          </TabsContent>
          <TabsContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 data-hidden:hidden" value="characters">
            <div className="mx-auto max-w-4xl space-y-6">
              <AssetSection title={t("角色档案", "Characters")}>
                {storyPackage.characters.map((item) => (
                  <article className="rounded-xl border p-4" key={item.name}>
                    <AssetHeading name={item.name} tag={item.role} />
                    <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                      <Detail label={t("外观", "Appearance")} value={item.ageAndAppearance} />
                      <Detail label={t("性格与动机", "Personality & motivation")} value={`${item.personality} ${item.motivation}`} />
                      <Detail label={t("成长弧光", "Character arc")} value={item.arc} />
                      <Detail label={t("关系", "Relationships")} value={item.relationships} />
                      <Detail label={t("语言风格", "Voice style")} value={item.voiceStyle} />
                    </dl>
                  </article>
                ))}
              </AssetSection>
            </div>
          </TabsContent>
          <TabsContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 data-hidden:hidden" value="locations">
            <div className="mx-auto max-w-4xl space-y-6">
              <AssetSection title={t("场景档案", "Locations")}>
                {storyPackage.locations.map((item) => (
                  <article className="rounded-xl border p-4" key={item.name}>
                    <AssetHeading name={item.name} />
                    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                      <Detail label={t("叙事作用", "Story function")} value={item.storyFunction} />
                      <Detail label={t("空间规则", "Spatial rules")} value={item.spatialRules} />
                      <Detail label={t("氛围", "Atmosphere")} value={item.atmosphere} />
                    </dl>
                  </article>
                ))}
              </AssetSection>
            </div>
          </TabsContent>
          <TabsContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 data-hidden:hidden" value="props">
            <div className="mx-auto max-w-4xl space-y-6">
              <AssetSection title={t("关键道具", "Key props")}>
                {storyPackage.props.length ? storyPackage.props.map((item) => (
                  <article className="rounded-xl border p-4" key={item.name}>
                    <AssetHeading name={item.name} />
                    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                      <Detail label={t("剧情作用", "Story function")} value={item.storyFunction} />
                      <Detail label={t("外观", "Appearance")} value={item.appearance} />
                      <Detail label={t("能力", "Capabilities")} value={item.capabilities} />
                      <Detail label={t("边界与代价", "Limits & cost")} value={`${item.limits} ${item.costOrConsequence}`} />
                    </dl>
                  </article>
                )) : <p className="text-sm text-muted-foreground">{t("本剧暂无关键道具。", "No key props are defined.")}</p>}
              </AssetSection>
            </div>
          </TabsContent>
          <TabsContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 data-hidden:hidden" value="episode">
            <div className="mx-auto max-w-4xl space-y-4">
              <div>
                <SectionTitle>{storyPackage.firstEpisode.title}</SectionTitle>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{storyPackage.firstEpisode.synopsis}</p>
                <p className="mt-2 text-xs leading-5"><span className="font-medium">{t("结尾钩子：", "Ending hook: ")}</span>{storyPackage.firstEpisode.endingHook}</p>
              </div>
              {storyPackage.firstEpisode.scenes.map((scene) => (
                <article className="rounded-xl border p-4" key={scene.sceneNumber}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{t("场次", "Scene")} {String(scene.sceneNumber).padStart(2, "0")}</Badge>
                    <span className="text-sm font-semibold">{scene.heading}</span>
                    <span className="text-xs text-muted-foreground">{scene.durationSeconds}{t(" 秒", " sec")}</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{scene.action}</p>
                  {scene.dialogue.length ? <div className="mt-3 space-y-1 border-l-2 pl-3 text-sm leading-6">{scene.dialogue.map((line, index) => <p key={`${line.speaker}-${index}`}><span className="font-semibold">{line.speaker}：</span>{line.line}</p>)}</div> : null}
                  <div className="mt-3 grid gap-2 text-xs leading-5 text-muted-foreground sm:grid-cols-2">
                    <p><span className="font-medium text-foreground">{t("镜头：", "Camera: ")}</span>{scene.camera}</p>
                    <p><span className="font-medium text-foreground">{t("声音：", "Sound: ")}</span>{scene.sound}</p>
                    <p className="sm:col-span-2"><span className="font-medium text-foreground">{t("场末状态：", "End state: ")}</span>{scene.endState}</p>
                  </div>
                </article>
              ))}
            </div>
          </TabsContent>
          <TabsContent className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 data-hidden:hidden" value="prompts">
            <div className="mx-auto max-w-4xl space-y-5">
              <section>
                <SectionTitle>{t("角色定妆图提示词", "Character image prompts")}</SectionTitle>
                <div className="mt-2 space-y-3">{storyPackage.characters.map((item) => <PromptCard key={item.name} label={item.name} prompt={item.imagePrompt} reference={t(`参考图槽位 ${item.imageReferenceSlot}`, `Reference slot ${item.imageReferenceSlot}`)} locale={locale} />)}</div>
              </section>
              <section>
                <SectionTitle>{t("场景概念图提示词", "Location image prompts")}</SectionTitle>
                <div className="mt-2 space-y-3">{storyPackage.locations.map((item) => <PromptCard key={item.name} label={item.name} prompt={item.imagePrompt} reference={t(`参考图槽位 ${item.imageReferenceSlot}`, `Reference slot ${item.imageReferenceSlot}`)} locale={locale} />)}</div>
              </section>
              {storyPackage.props.length ? <section>
                <SectionTitle>{t("道具图提示词", "Prop image prompts")}</SectionTitle>
                <div className="mt-2 space-y-3">{storyPackage.props.map((item) => <PromptCard key={item.name} label={item.name} prompt={item.imagePrompt} reference={t(`参考图槽位 ${item.imageReferenceSlot}`, `Reference slot ${item.imageReferenceSlot}`)} locale={locale} />)}</div>
              </section> : null}
              <section>
                <SectionTitle>{t("第 1 集视频分段提示词", "Episode 1 timed video prompts")}</SectionTitle>
                <div className="mt-2 space-y-3">{storyPackage.firstEpisode.scenes.map((scene) => (
                  <div className="space-y-2" key={scene.sceneNumber}>
                    <PromptCard label={`${t("场次", "Scene")} ${String(scene.sceneNumber).padStart(2, "0")} · ${scene.heading}`} prompt={scene.videoPrompt} locale={locale} />
                    {scene.imageReferenceSlots.length ? <p className="text-xs leading-5 text-muted-foreground">{t("待绑定参考图：", "Reference images to bind: ")}{scene.imageReferenceSlots.map((slot) => `${slot.number}. ${slot.name}`).join(" · ")}</p> : null}
                  </div>
                ))}</div>
              </section>
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter className="mx-0 mb-0 min-h-16 shrink-0 border-t px-5 py-3">
          <p className="mr-auto hidden min-w-0 text-xs leading-5 text-muted-foreground sm:block">{t("确认采用后同步到剧集和资产库。已有内容保留；只有第 1 集含完整正文，其余集为大纲。", "Adoption syncs episodes and assets, preserving existing work. Only episode 1 has a full script.")}</p>
          {projectId && deliverableId && (
            <Button className="shrink-0" disabled={adopting || adopted} onClick={() => void adopt()} type="button">
              {adopting && <LoaderCircle className="size-4 animate-spin" />}
              {adopted ? t("已采用", "Adopted") : t("确认采用并进入制作", "Adopt into production")}
            </Button>
          )}
          <Button className="shrink-0" variant="outline" onClick={() => onOpenChange(false)} type="button">{t("完成", "Done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold">{children}</h2>;
}

function StoryTable({ title, rows }: { title: string; rows: string[] }) {
  return (
    <section className="min-w-0">
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-2 space-y-2">
        {rows.map((row, index) => <p className="break-words rounded-lg border p-2.5 text-xs leading-5 text-muted-foreground" key={`${index}-${row}`}>{row}</p>)}
      </div>
    </section>
  );
}

function AssetSection({ children, title }: { children: ReactNode; title: string }) {
  return <section className="space-y-2"><SectionTitle>{title}</SectionTitle><div className="grid gap-2">{children}</div></section>;
}

function AssetHeading({ name, tag }: { name: string; tag?: string }) {
  return <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{name}</h3>{tag ? <Badge variant="outline">{tag}</Badge> : null}</div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-0.5 leading-6">{value}</dd></div>;
}

function PromptCard({
  label,
  locale,
  prompt,
  reference,
}: {
  label: string;
  locale: StudioLocale;
  prompt: string;
  reference?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success(locale === "en" ? "Prompt copied" : "提示词已复制");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(locale === "en" ? "Could not copy prompt" : "复制失败");
    }
  }
  return (
    <article className="min-w-0 rounded-xl border bg-muted/10 p-3">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">{label}</p>
          {reference ? <Badge className="mt-1" variant="secondary">{reference}</Badge> : null}
        </div>
        <Button className="shrink-0" onClick={() => void copyPrompt()} size="xs" type="button" variant="outline">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {locale === "en" ? "Copy" : "复制"}
        </Button>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">{prompt}</p>
    </article>
  );
}
