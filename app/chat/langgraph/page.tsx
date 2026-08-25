"use client";

import { useMemo } from "react";

import { Chat } from "@/components/agent/chat";
import { useAgent } from "@/hooks/use-agent";
import { createLangGraphAdapter } from "@/lib/agent/langgraph-adapter";

function LangGraphChat() {
  const adapter = useMemo(() => createLangGraphAdapter(), []);
  const agent = useAgent({
    adapter,
    threadId: "agent-ui-langgraph-demo",
  });

  return <Chat agent={agent} />;
}

export default function LangGraphChatPage() {
  return <LangGraphChat />;
}
