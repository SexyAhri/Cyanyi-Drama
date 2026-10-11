"use client";
import type { StorySetup } from "@/lib/studio/production-input";

import { useState } from "react";
import type { ComponentProps } from "react";
import {
  BookImage,
  Check,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Lightbulb,
  Plus,
  Smile,
  UsersRound,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { getProjectArtStyleLabel } from "@/lib/projects/art-style";
import { cn } from "@/lib/utils";

import type { StudioLocale } from "../types";

export const SCRIPT_TRENDING_TOPICS = [
  {
    title: "玄幻修仙逆袭",
    idea: "主角从被轻视的小人物起步，在修仙世界一步步逆袭。每集都有新的目标和升级爽点。",
    genre: "玄幻修仙",
  },
  {
    title: "现实职场成长",
    idea: "从一个普通职场人的真实困境出发，讲述主角靠专业能力与伙伴关系完成成长。",
    genre: "都市现实",
  },
  {
    title: "末世生存基建",
    idea: "末世降临后，主角带领一群普通人建立安全据点，在资源与人性考验中求生。",
    genre: "末世生存",
  },
  {
    title: "非遗国潮视觉",
    idea: "把非遗技艺与当代人物命运结合，让传统技艺成为解决冲突的关键。",
    genre: "历史传奇",
  },
  {
    title: "古代女频甜宠",
    idea: "古代背景下，两位性格鲜明的主角从误会和利益合作开始，发展出彼此守护的关系。",
    genre: "古装言情",
  },
  {
    title: "规则怪谈悬疑",
    idea: "一群人被困在必须遵守诡异规则的空间里，主角发现规则背后隐藏着层层真相。",
    genre: "惊悚怪谈",
  },
  {
    title: "重生复仇爽剧",
    idea: "主角重回人生转折点，凭借前世记忆改写命运，逐步揭开背叛与阴谋。",
    genre: "都市现实",
  },
  {
    title: "仙门团宠日常",
    idea: "被收留的小徒弟意外成为仙门团宠，在轻松日常中解决一连串危机。",
    genre: "玄幻修仙",
  },
] as const;

const GENRES = [
  "玄幻修仙",
  "都市现实",
  "古装言情",
  "悬疑推理",
  "惊悚怪谈",
  "犯罪谍战",
  "家庭伦理",
  "末世生存",
  "末世科幻",
  "历史传奇",
  "喜剧",
  "主旋律",
  "体育竞技",
];
const AUDIENCES = ["男频", "女频", "泛人群", "出海", "银发", "其他"];
const CHARACTERS = [
  "小人物",
  "打工人",
  "女强",
  "不完美成长型",
  "专业型",
  "天才",
  "双强",
  "腹黑",
  "黑莲花",
  "忠犬",
  "病娇",
  "福宝",
  "大小姐",
  "少爷",
  "王爷",
  "王妃",
  "皇帝",
  "将军",
  "修士",
  "龙王",
  "医者",
  "律师",
  "警察",
  "教师",
  "模特",
  "其他",
];
const ERAS = [
  "古代",
  "现代",
  "架空",
  "末世",
  "民国",
  "年代（80-90）",
  "近未来",
  "平行世界",
  "多时空穿越",
  "其他",
];
const HOOKS = [
  "器物金手指",
  "收集升级",
  "基建生存",
  "专业碾压",
  "马甲大佬",
  "先婚后爱",
  "重生复仇",
  "团宠被爱",
  "IP二创",
  "双向救赎",
  "穿越异世",
  "扮猪吃虎",
  "亲历行业细节",
  "真爽成长",
  "规则禁忌",
  "单元解谜",
  "文化元素新用",
  "风格混搭",
  "视觉奇观",
  "隐藏身份",
  "真假千金",
  "契约婚姻",
  "萌宝助攻",
  "婆媳逆袭",
  "系统傍身",
  "欢喜冤家",
  "普通人的处境",
  "群像时代切片",
  "姐弟恋",
  "穿书",
  "时间循环",
];
const STRUCTURES = [
  "三幕式",
  "五幕式",
  "英雄旅程",
  "平行结构",
  "交叉结构",
  "非线性结构",
  "环形结构",
  "单元结构",
];

type ScriptSetup = {
  genres: string[];
  audience: string[];
  characters: string[];
  eras: string[];
  hooks: string[];
  episodeCount: number;
  structure: string;
  popular: boolean;
};

const DEFAULT_SETUP: ScriptSetup = {
  genres: [],
  audience: [],
  characters: [],
  eras: [],
  hooks: [],
  episodeCount: 20,
  structure: "三幕式",
  popular: true,
};

export function ScriptSetupDialog({
  locale,
  onApply,
  projectArtStyle,
}: {
  locale: StudioLocale;
  onApply: (brief: string, setup: StorySetup) => void;
  projectArtStyle: string;
}) {
  const en = locale === "en";
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<ScriptSetup>(DEFAULT_SETUP);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const t = (zh: string, english: string) => (en ? english : zh);

  function applyTopic(topic: (typeof SCRIPT_TRENDING_TOPICS)[number]) {
    setSelectedPreset(topic.title);
    setSetup((value) => ({
      ...value,
      genres: [topic.genre],
      audience: topic.title.includes("女频") ? ["女频"] : value.audience,
      eras: topic.title.includes("古代") ? ["古代"] : value.eras,
    }));
  }

  function apply() {
    const selectedTopic = SCRIPT_TRENDING_TOPICS.find(
      (topic) => topic.title === selectedPreset,
    );
    const storyIdea = selectedTopic?.idea ?? "";
    const entries = [
      ["灵感预设", selectedPreset ?? ""],
      ["题材", setup.genres.join(" + ")],
      ["目标受众", setup.audience.join("、")],
      ["角色设定", setup.characters.join("、")],
      ["时代背景", setup.eras.join("、")],
      ["核心看点", setup.hooks.join("、")],
      ["核心创意", storyIdea],
      ["项目画风", getProjectArtStyleLabel(projectArtStyle, en ? "en" : "zh")],
      ["剧本结构", `${setup.episodeCount} 集 · ${setup.structure}`],
    ].filter(([, value]) => value);
    const brief = entries
      .map(([label, value]) => `${label}：${value}`)
      .join("\n");
    onApply(
      `请参考以下剧本设定：\n${brief}`,
      { ...setup, storyIdea, artStyle: projectArtStyle },
    );
    setOpen(false);
  }

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant={open ? "secondary" : "ghost"}
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <Clapperboard className="size-3.5" />
            {t("剧本设定器", "Script setup")}
          </Button>
        }
      />
      <DialogContent className="flex h-[min(90dvh,760px)] max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b px-5 py-4">
          <DialogTitle>{t("剧本设定器", "Script setup")}</DialogTitle>
        </DialogHeader>
        <div
          className={`grid min-h-0 flex-1 overflow-hidden ${setup.popular ? "md:grid-cols-[220px_minmax(0,1fr)]" : "grid-cols-1"}`}
        >
          {setup.popular && (
            <aside className="hidden min-h-0 flex-col overflow-hidden border-r bg-muted/15 p-4 md:flex">
              <h3 className="mb-3 text-sm font-semibold">
                {t("爆款预设 Top 8", "Trending presets Top 8")}
              </h3>
              <div className="min-h-0 space-y-2 overflow-y-auto">
                {SCRIPT_TRENDING_TOPICS.map((topic, index) => (
                  <button
                    aria-pressed={selectedPreset === topic.title}
                    className={`flex h-12 w-full items-center gap-2 overflow-hidden rounded-xl border px-2.5 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedPreset === topic.title ? "border-primary/60 bg-primary/5" : ""}`}
                    key={topic.title}
                    onClick={() => applyTopic(topic)}
                    type="button"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px]">
                      {index < 3 ? `❦${index + 1}❦` : index + 1}
                    </span>
                    <span className="truncate font-medium">
                      {en ? translateTopic(topic.title) : topic.title}
                    </span>
                  </button>
                ))}
              </div>
            </aside>
          )}
          <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
            <section className="min-h-52 border-b pb-5">
              <div className="grid min-h-52 grid-cols-[minmax(0,1fr)_minmax(112px,1.5fr)_minmax(0,1fr)] items-center gap-0 sm:grid-cols-[minmax(90px,1fr)_minmax(160px,1.5fr)_minmax(90px,1fr)] sm:gap-2">
                <div className="scrollbar-hidden max-h-48 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
                  {GENRES.map((genre) => (
                    <button
                      aria-pressed={setup.genres[0] === genre}
                      className={`block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs ${setup.genres[0] === genre ? "font-semibold text-foreground" : "text-muted-foreground hover:bg-muted"}`}
                      key={genre}
                      onClick={() => {
                        setSelectedPreset(null);
                        setSetup((value) => ({
                          ...value,
                          genres: selectPrimaryGenre(value.genres, genre),
                        }));
                      }}
                      type="button"
                    >
                      {t(genre, translateTopic(genre))}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-center gap-1">
                  <GenreOrb
                    label={setup.genres[0] ?? t("选择题材", "Choose a genre")}
                    active={Boolean(setup.genres[0])}
                  />
                  {setup.genres[1] ? (
                    <button
                      className="relative -ml-2 sm:-ml-3"
                      onClick={() => {
                        setSelectedPreset(null);
                        setSetup((value) => ({
                          ...value,
                          genres: value.genres.slice(0, 1),
                        }));
                      }}
                      title={t("移除融合题材", "Remove blended genre")}
                      type="button"
                    >
                      <GenreOrb
                        label={
                          en ? translateTopic(setup.genres[1]) : setup.genres[1]
                        }
                        active
                      />
                      <span className="absolute right-1 top-1 rounded-full bg-background p-0.5">
                        <X className="size-3" />
                      </span>
                    </button>
                  ) : (
                    <Popover>
                      <PopoverTrigger
                        render={
                          <button
                            className="-ml-2 flex size-14 shrink-0 flex-col items-center justify-center rounded-full border border-dashed bg-background/80 text-center text-[10px] text-muted-foreground shadow-sm sm:-ml-3 sm:size-20"
                            type="button"
                          >
                            <Plus className="mb-1 size-4" />
                            {t("融合题材", "Blend genres")}
                          </button>
                        }
                      />
                      <PopoverContent className="w-56">
                        <p className="mb-2 text-xs font-semibold">
                          {t("选择融合题材", "Choose a blended genre")}
                        </p>
                        <div className="scrollbar-hidden grid max-h-64 gap-1 overflow-y-auto overscroll-contain">
                          {GENRES.filter(
                            (genre) => !setup.genres.includes(genre),
                          ).map((genre) => (
                            <Button
                              key={genre}
                              className="justify-start"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSelectedPreset(null);
                                setSetup((value) => ({
                                  ...value,
                                  genres: toggleChoice(value.genres, genre, 2),
                                }));
                              }}
                            >
                              {en ? translateTopic(genre) : genre}
                            </Button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
                <div className="scrollbar-hidden max-h-48 space-y-1.5 overflow-y-auto overscroll-contain pl-1">
                  {GENRES.map((genre) => (
                    <button
                      aria-pressed={setup.genres[1] === genre}
                      className={`block w-full truncate rounded-lg px-2 py-1.5 text-right text-xs disabled:cursor-not-allowed disabled:opacity-40 ${setup.genres[1] === genre ? "font-semibold text-foreground" : "text-muted-foreground hover:bg-muted"}`}
                      disabled={setup.genres[0] === genre}
                      key={genre}
                      onClick={() => {
                        setSelectedPreset(null);
                        setSetup((value) => ({
                          ...value,
                          genres: selectFusionGenre(value.genres, genre),
                        }));
                      }}
                      type="button"
                    >
                      {t(genre, translateTopic(genre))}
                    </button>
                  ))}
                </div>
              </div>
              {setup.popular && (
                <div className="mt-2 flex flex-wrap justify-center gap-1.5 md:hidden">
                  {SCRIPT_TRENDING_TOPICS.map((topic) => (
                    <Button
                      aria-pressed={selectedPreset === topic.title}
                      key={topic.title}
                      size="xs"
                      variant="outline"
                      onClick={() => applyTopic(topic)}
                    >
                      {en ? translateTopic(topic.title) : topic.title}
                    </Button>
                  ))}
                </div>
              )}
            </section>
            <section className="border-b py-4">
              <div className="flex items-start gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
                <Clapperboard className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-xs font-medium">
                    {t("设定会带入导演助手对话", "Settings will be added to the Director Assistant chat")}
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    {t("未选择的设定由 AI 拟定，实际采用的设定会显示在故事大纲中。确认后可在输入框补充创意。", "AI decides unspecified settings and shows its decisions in the story outline. Add any story ideas after applying.")}
                  </p>
                </div>
              </div>
            </section>
            <div className="grid grid-cols-2 gap-2 pt-5 sm:grid-cols-3 xl:grid-cols-6">
              <SettingPopover
                icon={UsersRound}
                title={t("目标受众", "Audience")}
                summary={setup.audience}
                options={AUDIENCES}
                max={2}
                locale={locale}
                onChange={(value) =>
                  setSetup((current) => ({ ...current, audience: value }))
                }
              />
              <SettingPopover
                icon={Smile}
                title={t("角色设定", "Characters")}
                summary={setup.characters}
                options={CHARACTERS}
                max={5}
                locale={locale}
                onChange={(value) =>
                  setSetup((current) => ({ ...current, characters: value }))
                }
              />
              <SettingPopover
                icon={BookImage}
                title={t("时代背景", "Era")}
                summary={setup.eras}
                options={ERAS}
                max={2}
                locale={locale}
                onChange={(value) =>
                  setSetup((current) => ({ ...current, eras: value }))
                }
              />
              <SettingPopover
                icon={Lightbulb}
                title={t("核心看点", "Story hooks")}
                summary={setup.hooks}
                options={HOOKS}
                max={3}
                locale={locale}
                onChange={(value) =>
                  setSetup((current) => ({ ...current, hooks: value }))
                }
              />
              <div
                aria-label={t("项目画风", "Project art style")}
                className="flex h-18 min-w-0 w-full items-center gap-2 rounded-xl border bg-muted/60 p-2"
                title={getProjectArtStyleLabel(projectArtStyle, en ? "en" : "zh")}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <ImageIcon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {t("画风 · 项目设置", "Art style · Project settings")}
                  </span>
                  <span className="block truncate text-xs font-medium">
                    {getProjectArtStyleLabel(projectArtStyle, en ? "en" : "zh")}
                  </span>
                </span>
              </div>
              <Popover>
                <PopoverTrigger
                  render={
                    <SettingTile
                      icon={Film}
                      title={t("剧本结构", "Structure")}
                      summary={`${setup.episodeCount} ${t("集", "eps")} · ${t(setup.structure, translateStructure(setup.structure))}`}
                      active
                    />
                  }
                />
                <PopoverContent align="end" className="w-80 space-y-4">
                  <div>
                    <div className="mb-3 flex items-center justify-between text-xs font-semibold">
                      <span>{t("集数", "Episodes")}</span>
                      <Badge variant="secondary">
                        {setup.episodeCount} {t("集", "episodes")}
                      </Badge>
                    </div>
                    <Slider
                      aria-label={t("集数", "Episode count")}
                      min={1}
                      max={100}
                      step={1}
                      value={[setup.episodeCount]}
                      onValueChange={(value) =>
                        setSetup((current) => ({
                          ...current,
                          episodeCount:
                            typeof value === "number"
                              ? value
                              : (value[0] ?? 20),
                        }))
                      }
                    />
                    <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                      <span>1</span>
                      <span>100</span>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold">
                      {t("剧本结构", "Structure")}
                    </p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {STRUCTURES.map((item) => (
                        <Toggle
                          key={item}
                          pressed={setup.structure === item}
                          onPressedChange={(pressed) =>
                            pressed &&
                            setSetup((current) => ({
                              ...current,
                              structure: item,
                            }))
                          }
                          className="h-auto min-h-8 rounded-md border px-2 py-1 text-[10px] data-pressed:bg-secondary"
                        >
                          {t(item, translateStructure(item))}
                        </Toggle>
                      ))}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 flex-col-reverse items-stretch border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={setup.popular}
              onCheckedChange={(checked) =>
                setSetup((value) => ({ ...value, popular: checked }))
              }
            />
            {t("展示爆款预设", "Show trending presets")}
          </label>
          <div className="flex min-w-0 flex-wrap justify-end gap-2">
            <Button onClick={() => setOpen(false)} variant="outline">
              {t("取消", "Cancel")}
            </Button>
            <Button onClick={apply}>
              <Check className="size-4" />
              {t("带入对话", "Add to chat")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function SettingPopover({
  icon,
  title,
  summary,
  options,
  max,
  locale,
  onChange,
}: {
  icon: typeof UsersRound;
  title: string;
  summary: string[];
  options: string[];
  max: number;
  locale: StudioLocale;
  onChange: (value: string[]) => void;
}) {
  const en = locale === "en";
  return (
    <Popover>
      <PopoverTrigger
        render={
          <SettingTile
            icon={icon}
            title={title}
            summary={summary.join(en ? ", " : "、") || (en ? "AI decides" : "由 AI 拟定")}
            active={summary.length > 0}
          />
        }
      />
      <PopoverContent
        align="center"
        className="w-[min(22rem,calc(100vw-2rem))]"
      >
        <div className="mb-1 flex items-center justify-between text-xs font-semibold">
          <span>{title}</span>
          <span className="font-normal text-muted-foreground">
            {en ? `Up to ${max}` : `最多 ${max} 项`}
          </span>
        </div>
        <div className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto">
          {options.map((option) => {
            const selected = summary.includes(option);
            return (
              <Toggle
                key={option}
                pressed={selected}
                onPressedChange={(pressed) =>
                  onChange(toggleChoice(summary, option, max, pressed))
                }
                className="h-auto min-h-8 rounded-md border px-2 py-1 text-[10px] data-pressed:bg-secondary"
              >
                {option}
              </Toggle>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SettingTile({
  icon: Icon,
  title,
  summary,
  active,
  className,
  ...buttonProps
}: {
  icon: typeof UsersRound;
  title: string;
  summary: string;
  active?: boolean;
} & ComponentProps<"button">) {
  return (
    <button
      {...buttonProps}
      className={cn(
        `flex h-18 min-w-0 w-full items-center gap-2 rounded-xl border p-2 text-left transition-colors hover:bg-muted ${active ? "bg-muted/60" : "border-dashed"}`,
        className,
      )}
      type="button"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[10px] text-muted-foreground">
          {title}
        </span>
        <span className="block truncate text-xs font-medium">{summary}</span>
      </span>
    </button>
  );
}

function GenreOrb({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`flex size-16 shrink-0 items-center justify-center rounded-full border text-center text-xs font-semibold shadow-lg transition-colors sm:size-28 sm:text-sm ${active ? "border-primary/50 bg-gradient-to-br from-primary/35 via-muted to-secondary" : "bg-muted/60 text-muted-foreground"}`}
    >
      <span className="max-w-14 leading-4 sm:max-w-20 sm:leading-5">{label}</span>
    </span>
  );
}

function toggleChoice(
  current: string[],
  value: string,
  max: number,
  force?: boolean,
) {
  const has = current.includes(value);
  const add = force ?? !has;
  if (!add) return current.filter((item) => item !== value);
  if (has || current.length >= max) return current;
  return [...current, value];
}

function selectPrimaryGenre(current: string[], value: string) {
  if (current[0] === value) return current.slice(1);
  return [value, ...current.filter((item) => item !== value).slice(0, 1)];
}

function selectFusionGenre(current: string[], value: string) {
  if (current[0] === value) return current;
  if (current[1] === value) return current.slice(0, 1);
  return current.length > 0 ? [current[0], value] : [value];
}

function translateTopic(value: string) {
  const labels: Record<string, string> = {
    玄幻修仙逆袭: "Fantasy cultivation",
    现实职场成长: "Workplace growth",
    末世生存基建: "Post-apocalyptic survival",
    非遗国潮视觉: "Heritage and culture",
    古代女频甜宠: "Historical romance",
    规则怪谈悬疑: "Rules-based mystery",
    重生复仇爽剧: "Rebirth revenge",
    仙门团宠日常: "Cultivation found family",
    文旅非遗: "Heritage",
    玄幻修仙: "Fantasy cultivation",
    都市现实: "Urban realism",
    古装言情: "Historical romance",
    悬疑推理: "Mystery",
    惊悚怪谈: "Horror mystery",
    犯罪谍战: "Crime and espionage",
    家庭伦理: "Family drama",
    末世生存: "Apocalyptic survival",
    末世科幻: "Apocalyptic sci-fi",
    历史传奇: "Historical legend",
    喜剧: "Comedy",
    主旋律: "Main theme",
    体育竞技: "Sports competition",
  };
  return labels[value] ?? value;
}

function translateStructure(value: string) {
  const labels: Record<string, string> = {
    三幕式: "Three-act",
    五幕式: "Five-act",
    英雄旅程: "Hero's journey",
    平行结构: "Parallel",
    交叉结构: "Interwoven",
    非线性结构: "Nonlinear",
    环形结构: "Circular",
    单元结构: "Episodic",
  };
  return labels[value] ?? value;
}
