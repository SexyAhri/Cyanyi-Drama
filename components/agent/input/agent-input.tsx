"use client";

import { FormEvent, useState } from "react";

import { MessageInput } from "@/components/ui/message-input";

type AgentInputProps = {
  value: string;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function AgentInput({
  value,
  disabled,
  isLoading,
  placeholder = "Ask AI...",
  onChange,
  onSubmit,
}: AgentInputProps) {
  const [files, setFiles] = useState<File[] | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (value.trim().length > 0 && !disabled && !isLoading) {
      setFiles(null);
      onSubmit();
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <MessageInput
        allowAttachments
        className="min-h-16 rounded-lg py-4 pr-32"
        disabled={disabled || isLoading}
        files={files}
        isGenerating={Boolean(isLoading)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        setFiles={setFiles}
        submitOnEnter
        transcribeAudio={async () => ""}
        value={value}
      />
    </form>
  );
}
