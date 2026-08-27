"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type { AgentAdapter } from "@/lib/agent/adapter";
import { mergeAgentEvent } from "@/lib/agent/events";
import type { AgentEvent, AgentMessage } from "@/lib/agent/types";

const EMPTY_MESSAGES: AgentMessage[] = [];

export type UseAgentOptions = {
  adapter?: AgentAdapter;
  initialMessages?: AgentMessage[];
  threadId?: string;
  runId?: string;
  onError?: (error: Error) => void;
  onEvent?: (event: AgentEvent) => void;
};

export type SendMessageOptions = {
  metadata?: Record<string, unknown>;
};

export type AgentDebugState = {
  events: AgentEvent[];
  lastError?: string;
  pendingApprovalIds: string[];
  runningToolCallIds: string[];
};

export function useAgent({
  adapter,
  initialMessages = EMPTY_MESSAGES,
  threadId,
  runId,
  onError,
  onEvent,
}: UseAgentOptions = {}) {
  const [messages, setMessages] = useState<AgentMessage[]>(initialMessages);
  const messagesRef = useRef<AgentMessage[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pendingApprovalIds, setPendingApprovalIds] = useState<string[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);

  const reportError = useCallback(
    (unknownError: unknown) => {
      const nextError =
        unknownError instanceof Error
          ? unknownError
          : new Error("Agent operation failed.");

      setError(nextError);
      setEvents((current) => current.slice(-49));
      onError?.(nextError);
    },
    [onError],
  );

  const consumeEvents = useCallback(
    async (events: AsyncIterable<AgentEvent>) => {
      for await (const event of events) {
        onEvent?.(event);
        setEvents((current) => [...current.slice(-49), event]);

        if (event.type === "message.delta") {
          setIsStreaming(true);
        }

        if (event.type === "message.done") {
          setIsStreaming(false);
        }

        setMessages((current) => {
          const nextMessages = mergeAgentEvent(current, event);
          messagesRef.current = nextMessages;
          return nextMessages;
        });
      }
    },
    [onEvent],
  );

  const sendMessage = useCallback(
    async (content: string, options: SendMessageOptions = {}) => {
      const trimmed = content.trim();

      if (!trimmed) {
        return;
      }

      const userMessage: AgentMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
        metadata: sanitizeLocalMessageMetadata(options.metadata),
      };

      setError(null);
      setIsLoading(true);
      setMessages((current) => {
        const nextMessages = [...current, userMessage];
        messagesRef.current = nextMessages;
        return nextMessages;
      });

      try {
        if (adapter) {
          const nextMessages = messagesRef.current;
          await consumeEvents(
            adapter.sendMessage({
              messages: nextMessages,
              content: trimmed,
              threadId,
              runId,
              metadata: options.metadata,
            }),
          );
        }
      } catch (unknownError) {
        reportError(unknownError);
      } finally {
        setIsLoading(false);
        setIsStreaming(false);
      }
    },
    [adapter, consumeEvents, reportError, runId, threadId],
  );

  const resolveApproval = useCallback(
    async ({
      approvalId,
      decision,
      payload,
      reason,
    }: {
      approvalId: string;
      decision: "approved" | "denied";
      payload?: unknown;
      reason?: string;
    }) => {
      if (!adapter) {
        return;
      }

      if (pendingApprovalIds.includes(approvalId)) {
        return;
      }

      setError(null);
      setIsLoading(true);
      setPendingApprovalIds((current) => [...current, approvalId]);

      try {
        await consumeEvents(
          adapter.resolveApproval({
            approvalId,
            decision,
            payload,
            reason,
          }),
        );
      } catch (unknownError) {
        reportError(unknownError);
      } finally {
        setIsLoading(false);
        setIsStreaming(false);
        setPendingApprovalIds((current) =>
          current.filter((item) => item !== approvalId),
        );
      }
    },
    [adapter, consumeEvents, pendingApprovalIds, reportError],
  );

  const reset = useCallback(() => {
    messagesRef.current = initialMessages;
    setMessages(initialMessages);
    setError(null);
    setIsLoading(false);
    setIsStreaming(false);
    setPendingApprovalIds([]);
    setEvents([]);
  }, [initialMessages]);

  const loadMessages = useCallback((nextMessages: AgentMessage[]) => {
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setError(null);
    setIsLoading(false);
    setIsStreaming(false);
    setPendingApprovalIds([]);
    setEvents([]);
  }, []);

  const runningToolCallIds = useMemo(() => {
    return messages
      .map((message) => message.toolCall)
      .filter(
        (toolCall): toolCall is NonNullable<typeof toolCall> =>
          toolCall?.status === "running",
      )
      .map((toolCall) => toolCall.id);
  }, [messages]);

  const debug = useMemo<AgentDebugState>(
    () => ({
      events,
      lastError: error?.message,
      pendingApprovalIds,
      runningToolCallIds,
    }),
    [error?.message, events, pendingApprovalIds, runningToolCallIds],
  );

  return useMemo(
    () => ({
      messages,
      isLoading,
      isStreaming,
      error,
      pendingApprovalIds,
      runningToolCallIds,
      debug,
      sendMessage,
      approveToolCall: (approvalId: string, payload?: unknown) =>
        resolveApproval({
          approvalId,
          decision: "approved",
          payload,
        }),
      denyToolCall: (approvalId: string, reason?: string) =>
        resolveApproval({
          approvalId,
          decision: "denied",
          reason,
        }),
      loadMessages,
      reset,
    }),
    [
      error,
      isLoading,
      isStreaming,
      loadMessages,
      messages,
      pendingApprovalIds,
      runningToolCallIds,
      debug,
      reset,
      resolveApproval,
      sendMessage,
    ],
  );
}

export function sanitizeLocalMessageMetadata(
  metadata?: Record<string, unknown>,
) {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }

  const composer =
    "composer" in metadata &&
    metadata.composer &&
    typeof metadata.composer === "object"
      ? (metadata.composer as Record<string, unknown>)
      : null;

  if (!composer) {
    return undefined;
  }

  const referenceImages = Array.isArray(composer.referenceImages)
    ? composer.referenceImages
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object",
        )
        .map((item) => ({
          url: typeof item.url === "string" ? item.url : undefined,
          format: typeof item.format === "string" ? item.format : undefined,
          width: typeof item.width === "number" ? item.width : undefined,
          height: typeof item.height === "number" ? item.height : undefined,
          mimeType:
            typeof item.mimeType === "string" ? item.mimeType : undefined,
        }))
        .filter((item) => typeof item.url === "string" && item.url.trim())
    : [];

  const referenceImage =
    composer.referenceImage && typeof composer.referenceImage === "object"
      ? (composer.referenceImage as Record<string, unknown>)
      : null;

  return {
    composer: {
      mode: typeof composer.mode === "string" ? composer.mode : "chat",
      imageModel:
        typeof composer.imageModel === "string"
          ? composer.imageModel
          : undefined,
      videoModel:
        typeof composer.videoModel === "string"
          ? composer.videoModel
          : undefined,
      ratio: typeof composer.ratio === "string" ? composer.ratio : undefined,
      resolution:
        typeof composer.resolution === "string"
          ? composer.resolution
          : undefined,
      imageFormat:
        typeof composer.imageFormat === "string"
          ? composer.imageFormat
          : undefined,
      videoFormat:
        typeof composer.videoFormat === "string"
          ? composer.videoFormat
          : undefined,
      style: typeof composer.style === "string" ? composer.style : undefined,
      duration:
        typeof composer.duration === "string" ? composer.duration : undefined,
      referenceImages,
      referenceImage:
        referenceImage && typeof referenceImage.url === "string"
          ? {
              url: referenceImage.url,
              format:
                typeof referenceImage.format === "string"
                  ? referenceImage.format
                  : undefined,
              width:
                typeof referenceImage.width === "number"
                  ? referenceImage.width
                  : undefined,
              height:
                typeof referenceImage.height === "number"
                  ? referenceImage.height
                  : undefined,
              mimeType:
                typeof referenceImage.mimeType === "string"
                  ? referenceImage.mimeType
                  : undefined,
            }
          : undefined,
    },
  };
}
