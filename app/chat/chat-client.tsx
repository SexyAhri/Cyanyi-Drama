"use client";

import { Chat } from "@/components/agent/chat";
import { useAgent } from "@/hooks/use-agent";
import { createAiSdkAdapter } from "@/lib/agent/ai-sdk-adapter";

export function ChatClient() {
  const agent = useAgent({
    adapter: createAiSdkAdapter(),
  });

  return <Chat agent={agent} locale="zh-CN" />;
}
