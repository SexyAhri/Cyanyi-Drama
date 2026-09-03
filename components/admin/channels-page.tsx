"use client";

import { useRef } from "react";
import { Plus } from "lucide-react";

import { AdminPage } from "@/components/admin/admin-page";
import {
  ChannelSettingsPanel,
  type ChannelSettingsPanelHandle,
} from "@/components/agent/shell/channel-settings-panel";
import { getShellCopy } from "@/components/agent/shell/chat-shell-i18n";
import { Button } from "@/components/ui/button";

const emptyRuntime = {
  apiKey: "",
  baseUrl: "",
  protocol: "openai-compatible" as const,
  status: "idle" as const,
};

export function ChannelsPage() {
  const panelRef = useRef<ChannelSettingsPanelHandle>(null);
  const copy = getShellCopy("zh-CN");

  return (
    <AdminPage
      actions={
        <Button onClick={() => panelRef.current?.openCreate()} type="button">
          <Plus />
          {copy.settingsAddChannel}
        </Button>
      }
      description="集中配置上游协议、接口地址、密钥和可用模型。密钥只写入服务端，不会在页面回显。"
      title="渠道"
    >
      <ChannelSettingsPanel
        copy={copy}
        models={[]}
        onRuntimeConnectionChange={() => undefined}
        onRuntimeConnectionClear={() => undefined}
        ref={panelRef}
        runtimeConnection={emptyRuntime}
        showToolbar={false}
      />
    </AdminPage>
  );
}
