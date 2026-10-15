"use client";
import { SplitNovelDialog } from "../writing/split-novel-dialog";
import {
  studioProductionOptionsSchema,
  type StudioProductionOptions,
} from "@/lib/studio/production-input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCheck,
  Clapperboard,
  Layers3,
  Sparkles,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { MessageList } from "@/components/agent/message";
import { removeMessageGroup } from "@/components/agent/chat/chat-utils";
import type { ToolRegistry } from "@/components/agent/tool/tool-registry";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AgentMessage } from "@/lib/agent/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgent } from "@/hooks/use-agent";

import { getStageCopy } from "../i18n";
import type {
  StudioAgentContext,
  StudioLocale,
  StudioModelOption,
  StudioSelectionContext,
  WorkspaceSnapshot,
} from "../types";
import { ModelSelect } from "../components/model-select";
import { createStudioAgentAdapter } from "./studio-agent-adapter";
import {
  directorAssistantCopy,
  getDirectorSuggestions,
} from "./director-assistant-copy";
import { DirectorPromptReview } from "./director-prompt-review";
import {
  SCRIPT_TRENDING_TOPICS,
  ScriptSetupDialog,
} from "./script-setup-dialog";
import { trimMessagesForRegeneration } from "@/components/agent/chat/chat-utils";

const operations = [
  "cancel_media_task",
  "cancel_workflow",
  "pause_workflow",
  "resume_workflow",
  "revise_screenplay",
  "retry_media_task",
  "retry_workflow",
  "update_canvas_prompt",
  "start_script_organization",
  "start_storyboard_generation",
  "start_voice_analysis",
  "start_voice_design",
  "start_episode_adaptation",
  "start_asset_visual_design",
  "start_story_package_generation",
  "start_episode_preproduction",
  "start_manuscript_analysis",
  "start_original_episode_generation",
] as const;

function createStudioToolRegistry(locale: StudioLocale): ToolRegistry {
  const labels =
    locale === "en"
      ? [
          "Cancel media task",
          "Cancel workflow",
          "Pause workflow",
          "Resume workflow",
          "Revise screenplay",
          "Retry media task",
          "Retry workflow",
          "Update canvas prompt",
          "Organize scenes and assets",
          "Generate storyboard",
          "Analyze dialogue",
          "Design voice performance",
          "Adapt episode faithfully",
          "Design asset appearance",
          "Generate complete story package",
          "Continue episode preproduction",
          "Build source adaptation dossier",
          "Continue original episode",
        ]
      : [
          "取消媒体任务",
          "取消工作流",
          "暂停工作流",
          "恢复工作流",
          "修改剧本",
          "重试媒体任务",
          "重试工作流",
          "修改画布提示词草稿",
          "AI 场次与资产整理",
          "分镜生成",
          "台词分析",
          "配音表演设计",
          "忠实剧本改编",
          "资产视觉设计",
          "生成完整策划包",
          "继续本集前期制作",
          "建立原著改编资料",
          "续写原创本集正文",
        ];
  const description =
    locale === "en"
      ? "Requires your approval before changing production state."
      : "更改制作状态前需要你的批准。";
  return Object.fromEntries(
    operations.map((name, index) => [
      name,
      {
        label: labels[index],
        name,
        description:
          name === "start_story_package_generation"
            ? locale === "en"
              ? "Generate the complete story package and episode one from the current setup."
              : "根据当前设定生成完整策划包和第一集正文。"
            : description,
        showArgs:
          name === "revise_screenplay" || name === "update_canvas_prompt",
        ...(name.startsWith("start_")
          ? {
              hideProcessDetails: true,
              renderResult: () => (
                <p className="text-xs text-muted-foreground">
                  {locale === "en"
                      ? "Submitted. Follow progress and results in Tasks."
                      : "已提交，可在任务栏查看进度与结果。"}
                </p>
              ),
            }
          : {}),
        ...(name === "start_story_package_generation"
          ? {
              progressLabel:
                locale === "en" ? "Live package output" : "策划包实时输出",
              renderProgress: ({ text }: { text: string }) => (
                <div className="space-y-2">
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-anywhere rounded-md bg-muted/60 p-3 font-mono text-[11px] leading-relaxed">
                    {text}
                  </pre>
                </div>
              ),
            }
          : {}),
        ...(name === "update_canvas_prompt"
          ? {
              renderArgs: (value: unknown) => (
                <DirectorPromptReview value={value} locale={locale} />
              ),
              renderResult: (value: unknown) => (
                <DirectorPromptReview value={value} locale={locale} completed />
              ),
            }
          : {}),
      },
    ]),
  );
}

export function AgentPanel({
  analysisModelId,
  context,
  locale,
  models,
  onAnalysisModelChange,
  onRefresh,
  snapshot,
  selections,
  onSelectContext,
  onEditContext,
  beforeSend,
}: {
  analysisModelId: string;
  context: StudioAgentContext;
  locale: StudioLocale;
  models: StudioModelOption[];
  onAnalysisModelChange: (modelId: string) => void;
  onRefresh: () => Promise<unknown> | void;
  snapshot: WorkspaceSnapshot;
  selections?: StudioSelectionContext[];
  onSelectContext?: (selection: StudioSelectionContext) => void;
  onEditContext?: (selection: StudioSelectionContext) => void;
  beforeSend?: () => Promise<boolean>;
}) {
  const text = directorAssistantCopy[locale];
  const [input, setInput] = useState("");
  const [scriptBrief, setScriptBrief] = useState("");
  const [productionOptions, setProductionOptions] =
    useState<StudioProductionOptions>({});
  const [preparing, setPreparing] = useState(false);
  const submitting = useRef(false);
  const settingsId = useId();
  const [showJump, setShowJump] = useState(false);
  const scrollPane = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const followTail = useRef(true);
  const lastInput = useRef("");
  const suggestions = getDirectorSuggestions(context, locale);
  const episode = snapshot.project.episodes.find(
    (episode) => episode.id === context.episodeId,
  );
  const adapter = useMemo(
    () => createStudioAgentAdapter(snapshot.project.id),
    [snapshot.project.id],
  );
  const registry = useMemo(() => createStudioToolRegistry(locale), [locale]);
  const agent = useAgent({
    adapter,
    threadId: `studio:${snapshot.project.id}`,
    onEvent: (event) => {
      if (event.type === "tool.done") void onRefresh();
    },
  });
  const reset = agent.reset;
  const loadMessages = agent.loadMessages;
  const [historyProject, setHistoryProject] = useState<string | null>(null);
  const busy = preparing || agent.isLoading || agent.isStreaming;
  const awaitingApproval = agent.messages.some(
    (message) => message.toolCall?.status === "pending",
  );
  const contextKey = snapshot.project.id;

  useEffect(() => {
    reset();
    setHistoryProject(null);
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(`studio:chat:${contextKey}`) ?? "[]",
      );
      if (Array.isArray(saved))
        loadMessages(
          saved.slice(-100).flatMap((item) => {
            if (
              !item ||
              typeof item.id !== "string" ||
              (item.role !== "user" && item.role !== "assistant") ||
              typeof item.content !== "string"
            )
              return [];
            const metadata =
              item.metadata && typeof item.metadata === "object"
                ? item.metadata
                : null;
            const productionOptions = getStoredProductionOptions(
              metadata?.productionOptions,
            );
            return [
              {
                id: item.id,
                role: item.role,
                content: item.content.slice(0, 16000),
                ...(productionOptions
                  ? { metadata: { productionOptions } }
                  : {}),
              },
            ];
          }),
        );
    } catch {
      /* Browser storage may be unavailable. */
    }
    setHistoryProject(contextKey);
    setProductionOptions({});
    setInput("");
    setScriptBrief("");
    followTail.current = true;
    setShowJump(false);
    lastInput.current = "";
  }, [contextKey, reset, loadMessages]);
  useEffect(() => {
    if (historyProject !== contextKey || busy) return;
    try {
      const messages = agent.messages
        .filter(
          (message) => message.role === "user" || message.role === "assistant",
        )
        .slice(-100)
        .map(({ id, role, content, metadata }) => {
          const productionOptions = getStoredProductionOptions(
            metadata?.productionOptions,
          );
          return {
            id,
            role,
            content: content.slice(0, 16000),
            ...(productionOptions ? { metadata: { productionOptions } } : {}),
          };
        });
      localStorage.setItem(
        `studio:chat:${contextKey}`,
        JSON.stringify(messages),
      );
    } catch {
      /* Keep the current chat usable when storage is full. */
    }
  }, [agent.messages, busy, contextKey, historyProject]);
  useEffect(() => {
    if (followTail.current && scrollPane.current)
      scrollPane.current.scrollTop = scrollPane.current.scrollHeight;
  }, [agent.messages, busy]);
  useEffect(() => {
    if (agent.error) setInput((current) => current || lastInput.current);
  }, [agent.error]);

  function setComposerDraft(prompt: string) {
    setInput(prompt);
    composer.current?.focus();
  }

  function handleEditMessage(message: AgentMessage) {
    if (message.role !== "user") return;
    setInput(message.content);
    setScriptBrief("");
    setProductionOptions(
      getStoredProductionOptions(message.metadata?.productionOptions) ?? {},
    );
    composer.current?.focus();
  }

  function handleDeleteMessage(messageId: string) {
    agent.loadMessages(removeMessageGroup(agent.messages, messageId));
  }

  async function handleRegenerateMessage(messageId: string) {
    if (busy || submitting.current) return;
    const previousUserMessage = findPreviousUserMessage(
      agent.messages,
      messageId,
    );
    if (!previousUserMessage) return;

    submitting.current = true;
    setPreparing(true);
    try {
      if (beforeSend && !(await beforeSend())) return;
      const history = trimMessagesForRegeneration(
        agent.messages,
        previousUserMessage.id,
      );
      const productionOptions =
        getStoredProductionOptions(
          previousUserMessage.metadata?.productionOptions,
        ) ?? {};
      const selectedModel = models.find(
        (model) => model.id === analysisModelId,
      );
      setInput("");
      setScriptBrief("");
      setProductionOptions({});
      lastInput.current = previousUserMessage.content;
      followTail.current = true;
      setShowJump(false);
      agent.loadMessages(history);
      await agent.sendMessage(previousUserMessage.content, {
        metadata: {
          locale,
          studioContext: context,
          productionOptions,
          conversation: history
            .filter(
              (message) =>
                message.role === "user" || message.role === "assistant",
            )
            .slice(-12)
            .map((message) => ({
              role: message.role,
              content: message.content.slice(0, 4000),
            })),
          studioAgentModel: selectedModel
            ? {
                channelId: selectedModel.channelId,
                model: selectedModel.modelId,
              }
            : undefined,
        },
      });
    } finally {
      submitting.current = false;
      setPreparing(false);
    }
  }

  async function submit(value = input) {
    const message = value.trim();
    if (!message || busy || submitting.current) return;
    const activeBrief = scriptBrief;
    const content = activeBrief ? `${activeBrief}\n\n${message}` : message;
    submitting.current = true;
    setPreparing(true);
    try {
      if (beforeSend && !(await beforeSend())) return;
      const selectedModel = models.find(
        (model) => model.id === analysisModelId,
      );
      setInput("");
      lastInput.current = message;
      followTail.current = true;
      setShowJump(false);
      await agent.sendMessage(content, {
        metadata: {
          locale,
          studioContext: context,
          productionOptions,
          conversation: agent.messages
            .filter(
              (message) =>
                message.role === "user" || message.role === "assistant",
            )
            .slice(-12)
            .map((message) => ({
              role: message.role,
              content: message.content.slice(0, 4000),
            })),
          studioAgentModel: selectedModel
            ? {
                channelId: selectedModel.channelId,
                model: selectedModel.modelId,
              }
            : undefined,
        },
      });
      setScriptBrief("");
      setProductionOptions({});
    } finally {
      submitting.current = false;
      setPreparing(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Clapperboard className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium">{text.title}</h2>
            <p
              className="truncate text-[11px] text-muted-foreground"
              title={episode?.name ?? snapshot.project.name}
            >
              {episode?.name ?? snapshot.project.name}
            </p>
          </div>
        </div>
        {selections && onSelectContext && (
          <div className="mt-3 space-y-1.5">
            <label
              className="block text-[11px] text-muted-foreground"
              htmlFor={settingsId + "-target"}
            >
              {text.target}
            </label>
            <NativeSelect
              id={settingsId + "-target"}
              aria-label={text.target}
              disabled={busy || selections.length === 0}
              value={context.canvasNodeId ?? ""}
              onChange={(event) => {
                const target = selections.find(
                  (item) =>
                    (item.metadata?.canvasNodeId ?? item.id) ===
                    event.target.value,
                );
                if (target) onSelectContext(target);
              }}
              className="h-9 w-full min-w-0"
            >
              <NativeSelectOption value="" disabled>
                {selections.length ? text.pickTarget : text.noTargets}
              </NativeSelectOption>
              {selections.map((item) => (
                <NativeSelectOption
                  key={String(item.metadata?.canvasNodeId ?? item.id)}
                  value={String(item.metadata?.canvasNodeId ?? item.id)}
                >
                  {item.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-[11px] leading-5 text-muted-foreground">
              {text.targetHint}
            </p>
            {context.selection?.kind === "panel" && onEditContext && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (context.selection) onEditContext(context.selection);
                }}
              >
                {text.editShot}
              </Button>
            )}
          </div>
        )}
        <div
          className="mt-3 flex min-w-0 items-center gap-2 text-[11px]"
          aria-label={text.context}
        >
          <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-muted-foreground">
            {context.view === "canvas"
              ? text.canvas
              : getStageCopy(locale, context.stageId).title}
          </span>
          <span
            className="flex min-w-0 items-center gap-1.5"
            title={context.selection?.label ?? text.noSelection}
          >
            <Layers3
              className="size-3 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="truncate">
              {context.selection?.label ??
                (context.episodeId ? text.episode : text.project)}
            </span>
          </span>
        </div>
      </header>

      <div
        ref={scrollPane}
        aria-busy={agent.isLoading || agent.isStreaming}
        aria-label={text.messages}
        aria-live="polite"
        aria-relevant="additions text"
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-5"
        role="log"
        onScroll={(event) => {
          const pane = event.currentTarget;
          const nearBottom =
            pane.scrollHeight - pane.scrollTop - pane.clientHeight < 96;
          followTail.current = nearBottom;
          setShowJump(!nearBottom);
        }}
      >
        {agent.isLoading || agent.isStreaming ? (
          <span className="sr-only" role="status">
            {text.working}
          </span>
        ) : null}
        {agent.messages.length ? (
          <MessageList
            locale={locale}
            messages={agent.messages}
            onApprove={async (approvalId) => {
              if (busy || submitting.current) return;
              submitting.current = true;
              setPreparing(true);
              try {
                if (beforeSend && !(await beforeSend())) return;
                await agent.approveToolCall(approvalId);
              } finally {
                submitting.current = false;
                setPreparing(false);
              }
            }}
            onDeny={agent.denyToolCall}
            onDeleteMessage={handleDeleteMessage}
            onEditMessage={handleEditMessage}
            onRegenerateMessage={handleRegenerateMessage}
            pendingApprovalIds={agent.pendingApprovalIds}
            registry={registry}
            isThinking={busy}
          />
        ) : (
          <div className="flex h-full min-h-60 flex-col justify-center pb-6">
            <span className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-muted/70">
              <Sparkles
                className="size-5 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            {context.stageId === "writing" && context.view !== "canvas" ? (
              <>
                <h3 className="text-base font-semibold">
                  {locale === "en"
                    ? "Start with a trending idea"
                    : "从爆款题材开始"}
                </h3>
                <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SCRIPT_TRENDING_TOPICS.map((topic, index) => (
                    <button
                      className="flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors hover:border-foreground/25 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      key={topic.title}
                      onClick={() =>
                        setComposerDraft(
                          locale === "en"
                            ? `I'd like to create a short drama inspired by ${trendingTitle(topic.title)}.`
                            : `我想创作一部${topic.title}：${topic.idea}`,
                        )
                      }
                      type="button"
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">
                        #{index + 1}
                      </span>
                      <span className="truncate">
                        {locale === "en"
                          ? trendingTitle(topic.title)
                          : topic.title}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <h3 className="text-base font-medium">
                  {context.view === "canvas" ? text.emptyCanvas : text.empty}
                </h3>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  {text.description}
                </p>
                <div className="mt-5 grid gap-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.title}
                      onClick={() => setComposerDraft(suggestion.prompt)}
                      type="button"
                      disabled={busy}
                      title={text.draft}
                      className="group flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left text-xs transition-colors hover:border-foreground/20 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <span>{suggestion.title}</span>
                      <ArrowUp
                        className="size-3.5 rotate-45 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none"
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {showJump && agent.messages.length > 0 && (
        <div className="flex shrink-0 justify-center pb-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-full text-xs shadow-sm"
            onClick={() => {
              followTail.current = true;
              setShowJump(false);
              if (scrollPane.current)
                scrollPane.current.scrollTop = scrollPane.current.scrollHeight;
            }}
          >
            <ArrowDown className="size-3" />
            {text.jump}
          </Button>
        </div>
      )}

      <form
        className="shrink-0 border-t bg-background p-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {awaitingApproval && (
          <p
            className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"
            role="status"
          >
            <CheckCheck className="size-3.5" />
            {text.needsApproval}
          </p>
        )}
        <div className="rounded-2xl border bg-muted/25 p-1 transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
          {
            <div className="flex min-w-0 flex-wrap items-center gap-2 px-2 pt-1.5">
              <ScriptSetupDialog
                locale={locale}
                onApply={(brief, setup) => {
                  setScriptBrief(brief);
                  setProductionOptions({ storySetup: setup });
                  setInput(
                    locale === "en"
                      ? "Generate the complete story package based on these settings."
                      : "请根据以上设定生成完整策划包。",
                  );
                }}
                projectArtStyle={snapshot.project.config.artStyle}
              />
              <SplitNovelDialog
                locale={locale}
                models={models}
                onCompleted={onRefresh}
                projectId={snapshot.project.id}
                trigger={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                  >
                    {locale === "en" ? "Import novel" : "上传小说"}
                  </Button>
                }
              />
              {scriptBrief && (
                <span
                  className="min-w-0 truncate text-[10px] text-muted-foreground"
                  title={scriptBrief}
                >
                  {scriptBrief.split("\n").slice(1).join(" · ")}
                </span>
              )}
            </div>
          }
          <Textarea
            ref={composer}
            aria-label={text.ask}
            className="max-h-36 min-h-20 resize-none rounded-xl border-0 bg-transparent px-2.5 py-2.5 text-sm leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={text.ask}
            value={input}
          />
          <div className="flex min-w-0 items-center justify-between gap-2 px-2 pb-1.5">
            <div className="w-52 min-w-0 max-w-[calc(100%-2.5rem)]">
              <ModelSelect
                ariaLabel={text.model}
                className="h-7 border-transparent bg-transparent px-2 text-[11px] shadow-none hover:bg-muted"
                disabled={busy}
                models={models}
                onChange={onAnalysisModelChange}
                placeholder={text.noModel}
                showChannelInTrigger
                size="sm"
                value={analysisModelId}
              />
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={text.send}
                    className="size-8 shrink-0 rounded-full"
                    disabled={!input.trim() || busy}
                    size="icon-sm"
                    type="submit"
                  />
                }
              >
                {busy ? (
                  <span
                    className="size-2 rounded-full bg-current motion-safe:animate-pulse"
                    aria-hidden="true"
                  />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </TooltipTrigger>
              <TooltipContent>{text.send}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] leading-4 text-muted-foreground">
          {text.inputHint}
        </p>
        {agent.error ? (
          <div
            className="mt-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs"
            role="alert"
          >
            <p className="flex items-center gap-2 font-medium">
              <AlertCircle className="size-3.5 text-destructive" />
              {text.errorTitle}
            </p>
            <p className="mt-1.5 leading-5 text-muted-foreground">
              {text.errorRecovery}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-muted-foreground">
                {text.errorDetails}
              </summary>
              <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-anywhere leading-5 text-muted-foreground">
                {agent.error.message}
              </p>
            </details>
          </div>
        ) : null}
      </form>
    </div>
  );
}

function trendingTitle(title: string) {
  const labels: Record<string, string> = {
    玄幻修仙逆袭: "Fantasy cultivation comeback",
    现实职场成长: "Workplace growth",
    末世生存基建: "Post-apocalyptic survival",
    非遗国潮视觉: "Intangible heritage and culture",
    古代女频甜宠: "Historical romance",
    规则怪谈悬疑: "Rules-based mystery",
    重生复仇爽剧: "Rebirth revenge drama",
    仙门团宠日常: "Cultivation found family",
  };
  return labels[title] ?? title;
}

function getStoredProductionOptions(value: unknown) {
  const result = studioProductionOptionsSchema.safeParse(value);
  return result.success && Object.keys(result.data).length > 0
    ? result.data
    : null;
}

function findPreviousUserMessage(messages: AgentMessage[], messageId: string) {
  const targetIndex = messages.findIndex((message) => message.id === messageId);
  if (targetIndex < 0) return null;
  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index] ?? null;
  }
  return null;
}
