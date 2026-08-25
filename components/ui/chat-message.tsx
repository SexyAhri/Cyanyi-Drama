"use client";

import { useState } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "framer-motion";
import { Ban, ChevronRight, Code2, Loader2, Terminal } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FilePreview } from "@/components/ui/file-preview";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/utils";

const chatBubbleVariants = cva(
  "group/message relative break-words rounded-md px-3 py-3 text-sm leading-6 sm:max-w-[70%]",
  {
    variants: {
      isUser: {
        true: "bg-primary text-primary-foreground",
        false: "bg-muted text-foreground sm:max-w-[628px]",
      },
      animation: {
        none: "",
        slide: "duration-300 animate-in fade-in-0",
        scale: "duration-300 animate-in fade-in-0 zoom-in-75",
        fade: "duration-500 animate-in fade-in-0",
      },
    },
    compoundVariants: [
      {
        isUser: true,
        animation: "slide",
        class: "slide-in-from-right",
      },
      {
        isUser: false,
        animation: "slide",
        class: "slide-in-from-left",
      },
      {
        isUser: true,
        animation: "scale",
        class: "origin-bottom-right",
      },
      {
        isUser: false,
        animation: "scale",
        class: "origin-bottom-left",
      },
    ],
  },
);

type Animation = VariantProps<typeof chatBubbleVariants>["animation"];

type Attachment = {
  name?: string;
  contentType?: string;
  url: string;
};

type ToolInvocation =
  | {
      state: "partial-call" | "call";
      toolName: string;
    }
  | {
      state: "result";
      toolName: string;
      result: Record<string, unknown> & { __cancelled?: boolean };
    };

type ReasoningPart = {
  type: "reasoning";
  reasoning: string;
};

type ToolInvocationPart = {
  type: "tool-invocation";
  toolInvocation: ToolInvocation;
};

type TextPart = {
  type: "text";
  text: string;
};

type MessagePart =
  | TextPart
  | ReasoningPart
  | ToolInvocationPart
  | { type: "source"; source?: unknown }
  | { type: "file"; mimeType: string; data: string }
  | { type: "step-start" };

export type Message = {
  id: string;
  role: "user" | "assistant" | (string & {});
  content: string;
  createdAt?: Date;
  experimental_attachments?: Attachment[];
  toolInvocations?: ToolInvocation[];
  parts?: MessagePart[];
};

export type ChatMessageProps = Message & {
  emptyState?: React.ReactNode;
  showTimeStamp?: boolean;
  animation?: Animation;
  actions?: React.ReactNode;
  supplementalContent?: React.ReactNode;
};

export function ChatMessage({
  role,
  content,
  createdAt,
  showTimeStamp = false,
  animation = "scale",
  actions,
  supplementalContent,
  experimental_attachments,
  toolInvocations,
  parts,
  emptyState,
}: ChatMessageProps) {
  const isUser = role === "user";
  const formattedTime = createdAt?.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isUser) {
    return (
      <div className="group/message-row flex flex-col items-end">
        <Bubble animation={animation} isUser={isUser}>
          <MarkdownRenderer>{content}</MarkdownRenderer>
          {experimental_attachments?.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {experimental_attachments.map((attachment) => (
                <FilePreview
                  contentType={attachment.contentType}
                  key={attachment.url + (attachment.name ?? "")}
                  name={attachment.name}
                  previewUrl={attachment.url}
                />
              ))}
            </div>
          ) : null}
          {supplementalContent ? (
            <div className="mt-4 space-y-3">{supplementalContent}</div>
          ) : null}
        </Bubble>

        <MessageMeta
          actions={actions}
          animation={animation}
          createdAt={createdAt}
          formattedTime={formattedTime}
          isUser
          showTimeStamp={showTimeStamp}
        />
      </div>
    );
  }

  if (parts && parts.length > 0) {
    return (
      <>
        {parts.map((part, index) => {
          if (part.type === "text") {
            return (
              <AssistantText
                actions={actions}
                animation={animation}
                content={part.text}
                createdAt={createdAt}
                formattedTime={formattedTime}
                isUser={false}
                key={`text-${index}`}
                showTimeStamp={showTimeStamp}
              />
            );
          }

          if (part.type === "reasoning") {
            return <ReasoningBlock key={`reasoning-${index}`} part={part} />;
          }

          if (part.type === "tool-invocation") {
            return (
              <ToolCall
                key={`tool-${index}`}
                toolInvocations={[part.toolInvocation]}
              />
            );
          }

          return null;
        })}
      </>
    );
  }

  if (toolInvocations && toolInvocations.length > 0) {
    return <ToolCall toolInvocations={toolInvocations} />;
  }

  return (
    <AssistantText
      actions={actions}
      animation={animation}
      content={content}
      createdAt={createdAt}
      formattedTime={formattedTime}
      isUser={false}
      showTimeStamp={showTimeStamp}
      emptyState={emptyState}
      supplementalContent={supplementalContent}
    />
  );
}

function AssistantText({
  content,
  animation,
  actions,
  createdAt,
  formattedTime,
  isUser,
  showTimeStamp,
  supplementalContent,
  emptyState,
}: {
  content: string;
  animation: Animation;
  actions?: React.ReactNode;
  createdAt?: Date;
  formattedTime?: string;
  isUser: boolean;
  showTimeStamp: boolean;
  supplementalContent?: React.ReactNode;
  emptyState?: React.ReactNode;
}) {
  return (
    <div className="group/message-row flex flex-col items-start">
      <Bubble animation={animation} isUser={false}>
        {content.trim() ? <MarkdownRenderer>{content}</MarkdownRenderer> : emptyState}
        {supplementalContent ? (
          <div className="mt-4 space-y-3">{supplementalContent}</div>
        ) : null}
      </Bubble>

      <MessageMeta
        actions={actions}
        animation={animation}
        createdAt={createdAt}
        formattedTime={formattedTime}
        isUser={isUser}
        showTimeStamp={showTimeStamp}
      />
    </div>
  );
}

function Bubble({
  isUser,
  animation,
  children,
}: {
  isUser: boolean;
  animation: Animation;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(chatBubbleVariants({ isUser, animation }))}>
      {children}
    </div>
  );
}

function MessageMeta({
  actions,
  animation,
  createdAt,
  formattedTime,
  isUser,
  showTimeStamp,
}: {
  actions?: React.ReactNode;
  animation: Animation;
  createdAt?: Date;
  formattedTime?: string;
  isUser: boolean;
  showTimeStamp: boolean;
}) {
  if (!actions && (!showTimeStamp || !createdAt)) {
    return null;
  }

  return (
    <div className="mt-1 flex items-center gap-2 whitespace-nowrap text-muted-foreground">
      {isUser ? (
        <>
          {actions ? (
            <div className="flex items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover/message-row:opacity-100 sm:group-focus-within/message-row:opacity-100">
              {actions}
            </div>
          ) : null}
          <Timestamp
            animation={animation}
            createdAt={createdAt}
            formattedTime={formattedTime}
            show={showTimeStamp}
          />
        </>
      ) : (
        <>
          <Timestamp
            animation={animation}
            createdAt={createdAt}
            formattedTime={formattedTime}
            show={showTimeStamp}
          />
          {actions ? (
            <div className="flex items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover/message-row:opacity-100 sm:group-focus-within/message-row:opacity-100">
              {actions}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Timestamp({
  createdAt,
  formattedTime,
  show,
  animation,
}: {
  createdAt?: Date;
  formattedTime?: string;
  show: boolean;
  animation: Animation;
}) {
  if (!show || !createdAt) {
    return null;
  }

  return (
    <time
      className={cn(
        "block px-1 text-xs text-muted-foreground",
        animation !== "none" && "duration-500 animate-in fade-in-0",
      )}
      dateTime={createdAt.toISOString()}
    >
      {formattedTime}
    </time>
  );
}

function ReasoningBlock({ part }: { part: ReasoningPart }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-2 flex flex-col items-start sm:max-w-[70%]">
      <Collapsible
        className="group w-full overflow-hidden rounded-lg border bg-muted/50"
        onOpenChange={setIsOpen}
        open={isOpen}
      >
        <div className="flex items-center p-2">
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
            <span>Thinking</span>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <motion.div
            animate={isOpen ? "open" : "closed"}
            className="border-t"
            initial={false}
            transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
            variants={{
              open: { height: "auto", opacity: 1 },
              closed: { height: 0, opacity: 0 },
            }}
          >
            <div className="p-2">
              <div className="whitespace-pre-wrap text-xs">
                {part.reasoning}
              </div>
            </div>
          </motion.div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function ToolCall({
  toolInvocations,
}: Pick<ChatMessageProps, "toolInvocations">) {
  if (!toolInvocations?.length) {
    return null;
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {toolInvocations.map((invocation, index) => {
        if (invocation.state !== "result") {
          return (
            <div
              className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
              key={index}
            >
              <Terminal className="h-4 w-4" />
              <span>
                Calling <span className="font-mono">{invocation.toolName}</span>
                ...
              </span>
              <Loader2 className="h-3 w-3 animate-spin" />
            </div>
          );
        }

        const isCancelled = invocation.result.__cancelled === true;

        if (isCancelled) {
          return (
            <div
              className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
              key={index}
            >
              <Ban className="h-4 w-4" />
              <span>
                Cancelled <span className="font-mono">{invocation.toolName}</span>
              </span>
            </div>
          );
        }

        return (
          <div
            className="flex flex-col gap-1.5 rounded-lg border bg-muted/50 px-3 py-2 text-sm"
            key={index}
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <Code2 className="h-4 w-4" />
              <span>
                Result from{" "}
                <span className="font-mono">{invocation.toolName}</span>
              </span>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap text-foreground">
              {JSON.stringify(invocation.result, null, 2)}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
