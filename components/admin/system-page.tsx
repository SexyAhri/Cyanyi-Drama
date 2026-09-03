"use client";

import { useState } from "react";
import { LoaderCircle, Save } from "lucide-react";

import { AdminPage } from "@/components/admin/admin-page";
import {
  ADMIN_SETTINGS_FORM_ID,
  AdminSettingsPanel,
  type AdminSettingsPanelStatus,
} from "@/components/agent/shell/admin-settings-panel";
import { Button } from "@/components/ui/button";

export function SystemPage() {
  const [status, setStatus] = useState<AdminSettingsPanelStatus>({
    loading: true,
    saving: false,
  });
  const busy = status.loading || status.saving;

  return (
    <AdminPage
      actions={
        <Button disabled={busy} form={ADMIN_SETTINGS_FORM_ID} type="submit">
          {status.saving ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Save />
          )}
          {status.saving ? "保存中..." : "保存设置"}
        </Button>
      }
      description="管理登录注册、邮箱验证、第三方 OAuth 和易支付网关。敏感字段留空时保留原值。"
      title="系统管理"
    >
      <AdminSettingsPanel
        formId={ADMIN_SETTINGS_FORM_ID}
        onStatusChange={setStatus}
        showPricing={false}
      />
    </AdminPage>
  );
}
