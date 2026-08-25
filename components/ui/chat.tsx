"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { ArrowDown, ThumbsDown, ThumbsUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { type Message } from "@/components/ui/chat-message";
import { CopyButton } from "@/components/ui/copy-button";
import { MessageInput } from "@/components/ui/message-input";
import { ChatMessageList } from "@/components/ui/message-list";
import { PromptSuggestions } from "@/components/ui/prompt-suggestions";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { cn } from "@/lib/utils";

type ChatPropsBase = {
  handleSubmit: (
    event?: { preventDefault?: () => void },
    options?: { experimental_attachments?: FileList },
  ) => void;
  messages: Message[];
  input: string;
  inputPlaceholder?: string;
  className?: string;
  handleInputChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  isGenerating: boolean;
  stop?: () => void;
  onRateResponse?: (
    messageId: string,
    rating: "thumbs-up" | "thumbs-down",
  ) => void;
  setMessages?: (messages: Message[]) => void;
  suggestionsLabel?: string;
  transcribeAudio?: (blob: Blob) => Promise<string>;
};

type ChatPropsWithoutSuggestions = ChatPropsBase & {
  append?: never;
  suggestions?: never;
};

type ChatPropsWithSuggestions = ChatPropsBase & {
  append: (message: { role: "user"; content: string }) => void;
  suggestions: string[];
};

type ChatProps = ChatPropsWithoutSuggestions | ChatPropsWithSuggestions;

export function Chat({
  messages,
  handleSubmit,
  input,
  inputPlaceholder,
  handleInputChange,
  stop,
  isGenerating,
  append,
  suggestions,
  suggestionsLabel,
  className,
  onRateResponse,
  setMessages,
  transcribeAudio,
}: ChatProps) {
  const lastMessage = messages.at(-1);
  const isEmpty = messages.length === 0;
  const isTyping = lastMessage?.role === "user";

  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const handleStop = useCallback(() => {
    stop?.();

    if (!setMessages) {
      return;
    }

    const latestMessages = [...messagesRef.current];
    const lastAssistantMessage = latestMessages.findLast(
      (message) => message.role === "assistant",
    );

    if (!lastAssistantMessage?.toolInvocations) {
      return;
    }

    let needsUpdate = false;
    const updatedToolInvocations = lastAssistantMessage.toolInvocations.map(
      (toolInvocation) => {
        if (toolInvocation.state === "call") {
          needsUpdate = true;
          return {
            ...toolInvocation,
            state: "result",
            result: {
              content: "Tool execution was cancelled",
              __cancelled: true,
            },
          } as const;
        }

        return toolInvocation;
      },
    );

    if (!needsUpdate) {
      return;
    }

    const messageIndex = latestMessages.findIndex(
      (message) => message.id === lastAssistantMessage.id,
    );

    if (messageIndex !== -1) {
      latestMessages[messageIndex] = {
        ...lastAssistantMessage,
        toolInvocations: updatedToolInvocations,
      };
      setMessages(latestMessages);
    }
  }, [setMessages, stop]);

  const messageOptions = useCallback(
    (message: Message) => ({
      actions: onRateResponse ? (
        <>
          <div className="border-r pr-1">
            <CopyButton
              content={message.content}
              copyMessage="Copied response to clipboard!"
            />
          </div>
          <Button
            className="h-6 w-6"
            onClick={() => onRateResponse(message.id, "thumbs-up")}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ThumbsUp className="h-4 w-4" />
          </Button>
          <Button
            className="h-6 w-6"
            onClick={() => onRateResponse(message.id, "thumbs-down")}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ThumbsDown className="h-4 w-4" />
          </Button>
        </>
      ) : (
        <CopyButton
          content={message.content}
          copyMessage="Copied response to clipboard!"
        />
      ),
    }),
    [onRateResponse],
  );

  return (
    <ChatContainer className={className}>
      {isEmpty && append && suggestions ? (
        <PromptSuggestions
          append={append}
          label={suggestionsLabel ?? "Try these prompts ✨"}
          suggestions={suggestions}
        />
      ) : null}

      {messages.length > 0 ? (
        <ChatMessages messages={messages}>
          <ChatMessageList
            isTyping={isTyping}
            messageOptions={messageOptions}
            messages={messages}
          />
        </ChatMessages>
      ) : null}

      <ChatForm
        className="mt-auto"
        handleSubmit={handleSubmit}
        isPending={isGenerating || isTyping}
      >
        {({ files, setFiles }) => (
          <MessageInput
            allowAttachments
            files={files}
            isGenerating={isGenerating}
            onChange={handleInputChange}
            placeholder={inputPlaceholder}
            setFiles={setFiles}
            stop={handleStop}
            transcribeAudio={transcribeAudio}
            value={input}
          />
        )}
      </ChatForm>
    </ChatContainer>
  );
}

Chat.displayName = "Chat";

export function ChatMessages({
  messages,
  children,
}: React.PropsWithChildren<{
  messages: unknown[];
}>) {
  const {
    containerRef,
    scrollToBottom,
    handleScroll,
    shouldAutoScroll,
    handleTouchStart,
  } = useAutoScroll([messages]);

  return (
    <div className="relative min-h-0">
      <ScrollArea
        className="min-h-0 h-full"
        scrollbarClassName="w-2.5 translate-x-3 border-l-transparent pr-0"
        thumbClassName="bg-foreground/18 transition-colors hover:bg-foreground/28"
        viewportClassName="chat-messages-scroll min-h-0 h-full"
        viewportProps={{
          onScroll: handleScroll,
          onTouchStart: handleTouchStart,
          ref: containerRef,
        }}
      >
        <div className="max-w-full pb-4">{children}</div>
      </ScrollArea>
      {!shouldAutoScroll ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-end pr-2">
          <div className="flex w-full justify-end">
            <Button
              className="pointer-events-auto h-8 w-8 rounded-full ease-in-out animate-in fade-in-0 slide-in-from-bottom-1"
              onClick={scrollToBottom}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const ChatContainer = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      className={cn(
        "grid h-full min-h-0 max-h-full w-full grid-rows-[minmax(0,1fr)_auto] overflow-hidden",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

ChatContainer.displayName = "ChatContainer";

type ChatFormProps = {
  className?: string;
  isPending: boolean;
  handleSubmit: (
    event?: { preventDefault?: () => void },
    options?: { experimental_attachments?: FileList },
  ) => void;
  children: (props: {
    files: File[] | null;
    setFiles: React.Dispatch<React.SetStateAction<File[] | null>>;
  }) => ReactElement;
};

export const ChatForm = forwardRef<HTMLFormElement, ChatFormProps>(
  ({ children, handleSubmit, isPending: _isPending, className }, ref) => {
    const [files, setFiles] = useState<File[] | null>(null);

    const onSubmit = (event: React.FormEvent) => {
      if (!files) {
        handleSubmit(event);
        return;
      }

      const fileList = createFileList(files);
      handleSubmit(event, { experimental_attachments: fileList });
      setFiles(null);
    };

    void _isPending;

    return (
      <form className={className} onSubmit={onSubmit} ref={ref}>
        {children({ files, setFiles })}
      </form>
    );
  },
);

ChatForm.displayName = "ChatForm";

function createFileList(files: File[] | FileList): FileList {
  const dataTransfer = new DataTransfer();

  for (const file of Array.from(files)) {
    dataTransfer.items.add(file);
  }

  return dataTransfer.files;
}
