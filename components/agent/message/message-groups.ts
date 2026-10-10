import type { AgentMessage } from "../../../lib/agent/types";
import { splitPromptReply } from "@/lib/agent/reply-sections";

export type MessageGroup = {
  id: string;
  index: number;
  message: AgentMessage | null;
  toolMessages: AgentMessage[];
};

export function groupMessagesWithToolCards(
  messages: AgentMessage[],
): MessageGroup[] {
  const groups: MessageGroup[] = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => !message.toolCall)
    .map(({ message, index }) => ({
      id: message.id,
      index,
      message,
      toolMessages: [],
    }));
  const standaloneToolMessages: Array<{ index: number; message: AgentMessage }> =
    [];

  for (const [index, message] of messages.entries()) {
    if (!message.toolCall) {
      continue;
    }

    const previousNonToolGroup = findPreviousGroup(groups, index);
    const nextNonToolGroup = groups.find((group) => group.index > index);
    const targetGroup =
      previousNonToolGroup?.message?.role === "assistant"
        ? previousNonToolGroup
        : nextNonToolGroup?.message?.role === "assistant"
          ? nextNonToolGroup
          : null;

    if (targetGroup) {
      targetGroup.toolMessages.push(message);
      continue;
    }

    standaloneToolMessages.push({ index, message });
  }

  const ordinaryGroups = [
    ...groups,
    ...standaloneToolMessages.map(({ index, message }) => ({
      id: message.id,
      index,
      message: null,
      toolMessages: [message],
    })),
  ].sort((left, right) => left.index - right.index);

  return groupMediaTurns(messages, ordinaryGroups);
}

function findPreviousGroup(groups: MessageGroup[], index: number) {
  for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
    const group = groups[groupIndex];

    if (group && group.index < index) {
      return group;
    }
  }

  return null;
}

function groupMediaTurns(messages: AgentMessage[], groups: MessageGroup[]) {
  const result: MessageGroup[] = [];
  let start = 0;
  while (start < messages.length) {
    let end = start + 1;
    while (end < messages.length && messages[end].role !== "user") end++;
    const turn = messages.slice(start, end);
    const tools = turn.filter((message) => message.toolCall);
    const hasMedia = tools.some((message) => message.toolCall?.name === "image_generation" || message.toolCall?.name === "video_generation");
    if (!hasMedia) {
      result.push(...groups.filter((group) => group.index >= start && group.index < end));
    } else {
      const user = turn.find((message) => message.role === "user");
      if (user) result.push({ id: user.id, index: start, message: user, toolMessages: [] });
      const assistants = turn.filter((message) => message.role === "assistant");
      const process: string[] = [];
      const final: string[] = [];
      for (const assistant of assistants) {
        const boundary = assistant.metadata?.processContentLength;
        if (typeof boundary === "number") {
          process.push(assistant.content.slice(0, boundary));
          final.push(assistant.content.slice(boundary));
        } else if (Array.isArray(assistant.metadata?.explainedToolCallIds)) process.push(assistant.content);
        else final.push(assistant.content);
      }
      const base = assistants.at(-1);
      const finalContent = final.filter((text) => text.trim()).join("\n\n");
      const sections = splitPromptReply(finalContent);
      if (sections) process.push(sections.analysis);
      const finished = turn.map((message) => message.metadata?.finishedAt)
        .filter((value): value is string => typeof value === "string").sort().at(-1);
      const active = tools.some((message) => ["pending", "running"].includes(message.toolCall!.status));
      const anchor = base ?? { id: tools[0].id, role: "assistant" as const, content: "", createdAt: tools[0].createdAt };
      result.push({
        id: anchor.id, index: start + (user ? 1 : 0), toolMessages: tools,
        message: { ...anchor, content: sections?.answer ?? finalContent, metadata: {
          ...anchor.metadata, mediaTurn: true, processTexts: process.filter((text) => text.trim()),
          processStartedAt: user?.createdAt ?? turn[0].createdAt,
          processFinishedAt: active ? undefined : finished, processActive: active,
          explainedToolCallIds: assistants.flatMap((message) =>
            Array.isArray(message.metadata?.explainedToolCallIds) ? message.metadata.explainedToolCallIds : []),
        } },
      });
    }
    start = end;
  }
  return result;
}
