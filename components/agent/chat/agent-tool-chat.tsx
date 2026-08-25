"use client";

import {
  ChatForm,
  ChatMessages,
} from "@/components/ui/chat";
import { MessageInput } from "@/components/ui/message-input";
import type { useAgent } from "@/hooks/use-agent";

import { MessageList } from "../message";
import { toChatMessage } from "./message-mapper";

type AgentToolChatProps = {
  agent: ReturnType<typeof useAgent>;
  input: string;
  inputPlaceholder: string;
  handleInputChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  handleSubmit: (event?: { preventDefault?: () => void }) => void;
};

export function AgentToolChat({
  agent,
  input,
  inputPlaceholder,
  handleInputChange,
  handleSubmit,
}: AgentToolChatProps) {
  return (
    <div className="grid h-full max-h-full w-full grid-rows-[1fr_auto]">
      <ChatMessages messages={agent.messages.map(toChatMessage)}>
        <MessageList
          messages={agent.messages}
          onApprove={agent.approveToolCall}
          onDeny={agent.denyToolCall}
          pendingApprovalIds={agent.pendingApprovalIds}
        />
      </ChatMessages>
      <ChatForm
        className="mt-auto"
        handleSubmit={handleSubmit}
        isPending={agent.isLoading || agent.isStreaming}
      >
        {({ files, setFiles }) => (
          <MessageInput
            allowAttachments
            files={files}
            isGenerating={agent.isLoading || agent.isStreaming}
            onChange={handleInputChange}
            placeholder={inputPlaceholder}
            setFiles={setFiles}
            transcribeAudio={async () => ""}
            value={input}
          />
        )}
      </ChatForm>
    </div>
  );
}
