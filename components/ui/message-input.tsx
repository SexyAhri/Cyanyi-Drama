"use client";

import {
  type TextareaHTMLAttributes,
  useEffect,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Loader2, Mic, Paperclip, Square } from "lucide-react";

import { AudioVisualizer } from "@/components/ui/audio-visualizer";
import { Button } from "@/components/ui/button";
import { FilePreview } from "@/components/ui/file-preview";
import { InterruptPrompt } from "@/components/ui/interrupt-prompt";
import { useAudioRecording } from "@/hooks/use-audio-recording";
import { useAutosizeTextArea } from "@/hooks/use-autosize-textarea";
import { cn } from "@/lib/utils";

type MessageInputBaseProps =
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    value: string;
    submitOnEnter?: boolean;
    stop?: () => void;
    isGenerating: boolean;
    enableInterrupt?: boolean;
    transcribeAudio?: (blob: Blob) => Promise<string>;
  };

type MessageInputWithoutAttachmentProps = MessageInputBaseProps & {
  allowAttachments?: false;
};

type MessageInputWithAttachmentsProps = MessageInputBaseProps & {
  allowAttachments: true;
  files: File[] | null;
  setFiles: React.Dispatch<React.SetStateAction<File[] | null>>;
};

type MessageInputProps =
  | MessageInputWithoutAttachmentProps
  | MessageInputWithAttachmentsProps;

type MessageInputRestProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  allowAttachments?: boolean;
  files?: File[] | null;
  setFiles?: React.Dispatch<React.SetStateAction<File[] | null>>;
  enableInterrupt?: boolean;
  isGenerating?: boolean;
  stop?: () => void;
  submitOnEnter?: boolean;
  transcribeAudio?: (blob: Blob) => Promise<string>;
};

export function MessageInput({
  placeholder = "Ask AI...",
  className,
  onKeyDown: onKeyDownProp,
  submitOnEnter = true,
  stop,
  isGenerating,
  enableInterrupt = true,
  transcribeAudio,
  ...props
}: MessageInputProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [showInterruptPrompt, setShowInterruptPrompt] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [textAreaHeight, setTextAreaHeight] = useState(0);

  const {
    isListening,
    isSpeechSupported,
    isRecording,
    isTranscribing,
    audioStream,
    toggleListening,
    stopRecording,
  } = useAudioRecording({
    transcribeAudio,
    onTranscriptionComplete: (text) => {
      props.onChange?.({
        target: { value: text },
      } as React.ChangeEvent<HTMLTextAreaElement>);
    },
  });

  const showFileList =
    props.allowAttachments && props.files && props.files.length > 0;

  useAutosizeTextArea({
    ref: textAreaRef,
    maxHeight: 240,
    borderWidth: 1,
    dependencies: [props.value, showFileList],
  });

  useEffect(() => {
    if (!isGenerating) {
      setShowInterruptPrompt(false);
    }
  }, [isGenerating]);

  useEffect(() => {
    if (textAreaRef.current) {
      setTextAreaHeight(textAreaRef.current.offsetHeight);
    }
  }, [props.value]);

  function addFiles(files: File[] | null) {
    if (!props.allowAttachments || !files) {
      return;
    }

    props.setFiles((currentFiles) =>
      currentFiles ? [...currentFiles, ...files] : files,
    );
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (submitOnEnter && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      if (isGenerating && stop && enableInterrupt) {
        if (showInterruptPrompt) {
          stop();
          setShowInterruptPrompt(false);
          event.currentTarget.form?.requestSubmit();
        } else if (
          props.value ||
          (props.allowAttachments && props.files?.length)
        ) {
          setShowInterruptPrompt(true);
          return;
        }
      } else {
        event.currentTarget.form?.requestSubmit();
      }
    }

    onKeyDownProp?.(event);
  }

  function handleDragOver(event: React.DragEvent) {
    if (!props.allowAttachments) {
      return;
    }

    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event: React.DragEvent) {
    if (!props.allowAttachments) {
      return;
    }

    event.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(event: React.DragEvent) {
    setIsDragging(false);

    if (!props.allowAttachments) {
      return;
    }

    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files));
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!props.allowAttachments) {
      return;
    }

    const files = Array.from(event.clipboardData.items)
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (files.length > 0) {
      addFiles(files);
    }
  }

  const textareaProps = getTextareaProps(props);

  return (
    <div
      className="relative flex w-full"
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {enableInterrupt ? (
        <InterruptPrompt
          close={() => setShowInterruptPrompt(false)}
          isOpen={showInterruptPrompt}
        />
      ) : null}

      <div className="relative flex w-full items-center space-x-2">
        <div className="relative flex-1">
          <textarea
            aria-label="Write your prompt here"
            className={cn(
              "z-10 w-full grow resize-none rounded-xl border border-input bg-background p-3 pr-24 text-sm ring-offset-background transition-[border] placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
              showFileList && "pb-16",
              className,
            )}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            ref={textAreaRef}
            {...textareaProps}
          />

          {props.allowAttachments ? (
            <div className="absolute inset-x-3 bottom-0 z-20 overflow-x-auto py-3">
              <div className="flex space-x-3">
                <AnimatePresence mode="popLayout">
                  {props.files?.map((file) => (
                    <FilePreview
                      file={file}
                      key={file.name + String(file.lastModified)}
                      onRemove={() => {
                        props.setFiles((files) => {
                          if (!files) {
                            return null;
                          }

                          const filtered = files.filter((item) => item !== file);
                          return filtered.length > 0 ? filtered : null;
                        });
                      }}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="absolute right-3 top-3 z-20 flex gap-2">
        {props.allowAttachments ? (
          <Button
            aria-label="Attach a file"
            className="h-8 w-8"
            onClick={async () => addFiles(await showFileUploadDialog())}
            size="icon"
            type="button"
            variant="outline"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
        ) : null}

        {isSpeechSupported ? (
          <Button
            aria-label="Voice input"
            className={cn("h-8 w-8", isListening && "text-primary")}
            onClick={toggleListening}
            size="icon"
            type="button"
            variant="outline"
          >
            <Mic className="h-4 w-4" />
          </Button>
        ) : null}

        {isGenerating && stop ? (
          <Button
            aria-label="Stop generating"
            className="h-8 w-8"
            onClick={stop}
            size="icon"
            type="button"
          >
            <Square className="h-3 w-3 animate-pulse" fill="currentColor" />
          </Button>
        ) : (
          <Button
            aria-label="Send message"
            className="h-8 w-8 transition-opacity"
            disabled={props.value === "" || isGenerating}
            size="icon"
            type="submit"
          >
            <ArrowUp className="h-5 w-5" />
          </Button>
        )}
      </div>

      {props.allowAttachments ? (
        <FileUploadOverlay isDragging={isDragging} />
      ) : null}

      <RecordingControls
        audioStream={audioStream}
        isRecording={isRecording}
        isTranscribing={isTranscribing}
        onStopRecording={stopRecording}
        textAreaHeight={textAreaHeight}
      />
    </div>
  );
}

MessageInput.displayName = "MessageInput";

function getTextareaProps(
  props: MessageInputRestProps,
): TextareaHTMLAttributes<HTMLTextAreaElement> {
  if (props.allowAttachments) {
    const {
      allowAttachments,
      files,
      setFiles,
      isGenerating,
      enableInterrupt,
      stop,
      submitOnEnter,
      transcribeAudio,
      ...textareaProps
    } = props;

    void allowAttachments;
    void files;
    void setFiles;
    void isGenerating;
    void enableInterrupt;
    void stop;
    void submitOnEnter;
    void transcribeAudio;

    return textareaProps;
  }

  const {
    allowAttachments,
    isGenerating,
    enableInterrupt,
    stop,
    submitOnEnter,
    transcribeAudio,
    ...textareaProps
  } = props;

  void allowAttachments;
  void isGenerating;
  void enableInterrupt;
  void stop;
  void submitOnEnter;
  void transcribeAudio;

  return textareaProps;
}

function FileUploadOverlay({ isDragging }: { isDragging: boolean }) {
  return (
    <AnimatePresence>
      {isDragging ? (
        <motion.div
          animate={{ opacity: 1 }}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center space-x-2 rounded-xl border border-dashed border-border bg-background text-sm text-muted-foreground"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Paperclip className="h-4 w-4" />
          <span>Drop your files here to attach them.</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function showFileUploadDialog() {
  const input = document.createElement("input");

  input.accept = "*/*";
  input.multiple = true;
  input.type = "file";
  input.click();

  return new Promise<File[] | null>((resolve) => {
    input.onchange = (event) => {
      const files = (event.currentTarget as HTMLInputElement).files;
      resolve(files ? Array.from(files) : null);
    };
  });
}

function RecordingControls({
  isRecording,
  isTranscribing,
  audioStream,
  textAreaHeight,
  onStopRecording,
}: {
  isRecording: boolean;
  isTranscribing: boolean;
  audioStream: MediaStream | null;
  textAreaHeight: number;
  onStopRecording: () => void;
}) {
  if (isRecording) {
    return (
      <div
        className="absolute inset-[1px] z-50 overflow-hidden rounded-xl"
        style={{ height: textAreaHeight - 2 }}
      >
        <AudioVisualizer
          isRecording={isRecording}
          onClick={onStopRecording}
          stream={audioStream}
        />
      </div>
    );
  }

  if (isTranscribing) {
    return (
      <div
        className="absolute inset-[1px] z-50 overflow-hidden rounded-xl"
        style={{ height: textAreaHeight - 2 }}
      >
        <div className="flex h-full w-full flex-col items-center justify-center rounded-xl bg-background/80 backdrop-blur-sm">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm font-medium text-muted-foreground">
            Transcribing audio...
          </p>
        </div>
      </div>
    );
  }

  return null;
}
