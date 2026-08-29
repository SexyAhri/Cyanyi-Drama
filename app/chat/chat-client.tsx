"use client";

import { Chat } from "@/components/agent/chat";
import { useAgent } from "@/hooks/use-agent";
import { createAiSdkAdapter } from "@/lib/agent/ai-sdk-adapter";

export function ChatClient({ appVersion }: { appVersion: string }) {
  const agent = useAgent({
    adapter: createAiSdkAdapter(),
  });

  return <Chat agent={agent} appVersion={appVersion} locale="zh-CN" />;
}
