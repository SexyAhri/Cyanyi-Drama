import type { AgentMessage } from "../../../lib/agent/types";

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

  return [
    ...groups,
    ...standaloneToolMessages.map(({ index, message }) => ({
      id: message.id,
      index,
      message: null,
      toolMessages: [message],
    })),
  ].sort((left, right) => left.index - right.index);
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
