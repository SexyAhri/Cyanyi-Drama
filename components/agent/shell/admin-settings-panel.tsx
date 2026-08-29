"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminSystemSettingsView } from "@/lib/server/system-settings";

export const ADMIN_SETTINGS_FORM_ID = "agent-admin-settings-form";

export type AdminSettingsPanelStatus = {
  loading: boolean;
  saving: boolean;
};

type AdminSettingsPanelProps = {
  formId: string;
  onStatusChange: (status: AdminSettingsPanelStatus) => void;
};

type CallbackUrls = {
  github: string;
  linuxdo: string;
  epayNotify: string;
  epayReturn: string;
};

type Price = {
  id: string;
  provider: string;
  model: string;
  capability: string;
  unit: string;
  unitPrice: string;
  active: boolean;
};

type AdminChannel = {
  id: string;
  name: string;
  providerKey: string;
  models?: Array<{
    id: string;
    modelId?: string;
    name: string;
    type?: string;
    selected?: boolean;
  }>;
};

type SecretDraft = {
  smtpPassword: string;
  githubClientSecret: string;
  linuxdoClientSecret: string;
  epayMerchantKey: string;
};

const EMPTY_SETTINGS: AdminSystemSettingsView = {
  registrationEnabled: true,
  emailAuthEnabled: true,
  emailVerificationEnabled: false,
  smtpHost: "",
  smtpPort: 465,
  smtpSecure: true,
  smtpUsername: "",
  smtpFrom: "",
  smtpPasswordConfigured: false,
  githubEnabled: false,
  githubClientId: "",
  githubClientSecretConfigured: false,
  linuxdoEnabled: false,
  linuxdoClientId: "",
  linuxdoClientSecretConfigured: false,
  linuxdoMinimumTrustLevel: 0,
  epayEnabled: false,
  epayGatewayUrl: "",
  epayMerchantId: "",
  epayMerchantKeyConfigured: false,
  epayMethods: ["alipay", "wxpay"],
  epayMinimumAmount: "1",
  epayCreditRate: "1",
};

const EMPTY_SECRETS: SecretDraft = {
  smtpPassword: "",
  githubClientSecret: "",
  linuxdoClientSecret: "",
  epayMerchantKey: "",
};

export function AdminSettingsPanel({
  formId,
  onStatusChange,
}: AdminSettingsPanelProps) {
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [secrets, setSecrets] = useState(EMPTY_SECRETS);
  const [callbacks, setCallbacks] = useState<CallbackUrls | null>(null);
  const [prices, setPrices] = useState<Price[]>([]);
  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceDraft, setPriceDraft] = useState({
    modelKey: "",
    capability: "image",
    unit: "image",
    unitPrice: "0",
  });

  const modelOptions = useMemo(
    () =>
      channels.flatMap((channel) =>
        (channel.models ?? [])
          .filter((model) => model.selected !== false)
          .map((model) => ({
            key: JSON.stringify([channel.id, model.modelId || model.id]),
            provider: channel.providerKey,
            model: model.modelId || model.id,
            capability: model.type === "llm" ? "text" : model.type || "image",
            label: `${model.name} · ${channel.name}`,
          })),
      ),
    [channels],
  );

  useEffect(() => {
    onStatusChange({ loading, saving });
  }, [loading, onStatusChange, saving]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/admin/settings", { cache: "no-store" }).then(readJson),
      fetch("/api/billing/prices", { cache: "no-store" }).then(readJson),
      fetch("/api/channels", { cache: "no-store" }).then(readJson),
    ])
      .then(([systemPayload, pricePayload, channelPayload]) => {
        if (!active) return;
        setSettings(systemPayload.settings as AdminSystemSettingsView);
        setCallbacks(systemPayload.callbacks as CallbackUrls);
        setPrices((pricePayload.prices as Price[]) ?? []);
        setChannels((channelPayload.channels as AdminChannel[]) ?? []);
      })
      .catch((error) => {
        if (active) toast.error(readableError(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function update<K extends keyof AdminSystemSettingsView>(
    field: K,
    value: AdminSystemSettingsView[K],
  ) {
    setSettings((current) => ({ ...current, [field]: value }));
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, ...secrets }),
      });
      const payload = await readJson(response);
      setSettings(payload.settings as AdminSystemSettingsView);
      setSecrets(EMPTY_SECRETS);
      toast.success("管理员设置已保存");
    } catch (error) {
      toast.error(readableError(error));
    } finally {
      setSaving(false);
    }
  }

  async function addPrice() {
    const selected = modelOptions.find((item) => item.key === priceDraft.modelKey);
    if (!selected) {
      toast.error("请选择已配置的模型");
      return;
    }
    setPriceSaving(true);
    try {
      const response = await fetch("/api/billing/prices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selected.provider,
          model: selected.model,
          capability: priceDraft.capability,
          unit: priceDraft.unit,
          unitPrice: priceDraft.unitPrice,
          active: true,
        }),
      });
      const payload = await readJson(response);
      const saved = payload.price as Price;
      setPrices((current) => [
        ...current.filter((item) => item.id !== saved.id),
        saved,
      ]);
      toast.success("模型价格已保存");
    } catch (error) {
      toast.error(readableError(error));
    } finally {
      setPriceSaving(false);
    }
  }

  async function deletePrice(id: string) {
    try {
      await readJson(
        await fetch(`/api/billing/prices?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      );
      setPrices((current) => current.filter((item) => item.id !== id));
    } catch (error) {
      toast.error(readableError(error));
    }
  }

  return (
    <form
      className="grid gap-8"
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        void saveSettings();
      }}
    >
      <SettingsSection
        description="控制邮箱密码登录、开放注册和注册验证码。关闭邮箱登录前必须先启用一个 OAuth 服务。"
        title="邮箱登录与注册"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <ToggleField
            checked={settings.emailAuthEnabled}
            disabled={loading || saving}
            label="邮箱密码登录"
            onChange={(checked) => update("emailAuthEnabled", checked)}
          />
          <ToggleField
            checked={settings.registrationEnabled}
            disabled={loading || saving}
            label="允许注册"
            onChange={(checked) => update("registrationEnabled", checked)}
          />
          <ToggleField
            checked={settings.emailVerificationEnabled}
            disabled={loading || saving}
            label="注册邮箱验证码"
            onChange={(checked) => update("emailVerificationEnabled", checked)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField
            label="SMTP 主机"
            onChange={(value) => update("smtpHost", value)}
            placeholder="smtp.example.com"
            value={settings.smtpHost}
          />
          <TextField
            label="端口"
            onChange={(value) => update("smtpPort", Number(value) || 0)}
            type="number"
            value={String(settings.smtpPort)}
          />
          <TextField
            label="SMTP 用户名"
            onChange={(value) => update("smtpUsername", value)}
            value={settings.smtpUsername}
          />
          <SecretField
            configured={settings.smtpPasswordConfigured}
            label="SMTP 密码 / Token"
            onChange={(value) =>
              setSecrets((current) => ({ ...current, smtpPassword: value }))
            }
            value={secrets.smtpPassword}
          />
          <TextField
            label="发件地址"
            onChange={(value) => update("smtpFrom", value)}
            placeholder="noreply@example.com"
            value={settings.smtpFrom}
          />
          <ToggleField
            checked={settings.smtpSecure}
            disabled={loading || saving}
            label="SSL / TLS"
            onChange={(checked) => update("smtpSecure", checked)}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        description="保存 Client ID 和 Secret 后启用。Secret 加密保存，页面不会再次回显。"
        title="第三方登录"
      >
        <ProviderFields
          callback={callbacks?.github}
          clientId={settings.githubClientId}
          configured={settings.githubClientSecretConfigured}
          enabled={settings.githubEnabled}
          name="GitHub"
          onClientIdChange={(value) => update("githubClientId", value)}
          onEnabledChange={(checked) => update("githubEnabled", checked)}
          onSecretChange={(value) =>
            setSecrets((current) => ({ ...current, githubClientSecret: value }))
          }
          secret={secrets.githubClientSecret}
        />
        <ProviderFields
          callback={callbacks?.linuxdo}
          clientId={settings.linuxdoClientId}
          configured={settings.linuxdoClientSecretConfigured}
          enabled={settings.linuxdoEnabled}
          name="LinuxDO"
          onClientIdChange={(value) => update("linuxdoClientId", value)}
          onEnabledChange={(checked) => update("linuxdoEnabled", checked)}
          onSecretChange={(value) =>
            setSecrets((current) => ({ ...current, linuxdoClientSecret: value }))
          }
          secret={secrets.linuxdoClientSecret}
        >
          <TextField
            label="最低信任等级"
            onChange={(value) =>
              update("linuxdoMinimumTrustLevel", Number(value) || 0)
            }
            type="number"
            value={String(settings.linuxdoMinimumTrustLevel)}
          />
        </ProviderFields>
      </SettingsSection>

      <SettingsSection
        description="兼容标准易支付 submit.php 与 MD5 回调验签。支付回调按订单金额幂等入账。"
        title="通用易支付"
      >
        <ToggleField
          checked={settings.epayEnabled}
          disabled={loading || saving}
          label="启用在线充值"
          onChange={(checked) => update("epayEnabled", checked)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="网关地址"
            onChange={(value) => update("epayGatewayUrl", value)}
            placeholder="https://pay.example.com"
            value={settings.epayGatewayUrl}
          />
          <TextField
            label="商户 ID"
            onChange={(value) => update("epayMerchantId", value)}
            value={settings.epayMerchantId}
          />
          <SecretField
            configured={settings.epayMerchantKeyConfigured}
            label="商户密钥"
            onChange={(value) =>
              setSecrets((current) => ({ ...current, epayMerchantKey: value }))
            }
            value={secrets.epayMerchantKey}
          />
          <TextField
            label="最低充值金额"
            onChange={(value) => update("epayMinimumAmount", value)}
            type="number"
            value={settings.epayMinimumAmount}
          />
          <TextField
            label="到账倍率"
            onChange={(value) => update("epayCreditRate", value)}
            type="number"
            value={settings.epayCreditRate}
          />
        </div>
        <div className="flex flex-wrap gap-4">
          {[
            ["alipay", "支付宝"],
            ["wxpay", "微信支付"],
            ["qqpay", "QQ 钱包"],
          ].map(([value, label]) => (
            <ToggleField
              checked={settings.epayMethods.includes(value)}
              disabled={loading || saving}
              key={value}
              label={label}
              onChange={(checked) =>
                update(
                  "epayMethods",
                  checked
                    ? [...new Set([...settings.epayMethods, value])]
                    : settings.epayMethods.filter((item) => item !== value),
                )
              }
            />
          ))}
        </div>
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <p className="break-all">通知地址：{callbacks?.epayNotify || "-"}</p>
          <p className="break-all">返回地址：{callbacks?.epayReturn || "-"}</p>
        </div>
      </SettingsSection>

      <SettingsSection
        description="价格单位决定计费方式；同一模型可配置多个单位并叠加计费。"
        title="模型价格与计费方式"
      >
        <div className="grid items-end gap-3 lg:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_auto]">
          <SelectField
            label="模型"
            onChange={(value) => {
              const option = modelOptions.find((item) => item.key === value);
              setPriceDraft((current) => ({
                ...current,
                modelKey: value,
                capability: option?.capability || current.capability,
              }));
            }}
            options={modelOptions.map((item) => ({ label: item.label, value: item.key }))}
            placeholder="选择模型"
            value={priceDraft.modelKey}
          />
          <SelectField
            label="能力"
            onChange={(value) => setPriceDraft((current) => ({ ...current, capability: value }))}
            options={["text", "image", "video", "audio", "lipsync", "voicedesign"].map((value) => ({ label: value, value }))}
            value={priceDraft.capability}
          />
          <SelectField
            label="计费方式"
            onChange={(value) => setPriceDraft((current) => ({ ...current, unit: value }))}
            options={[
              { label: "每次请求", value: "request" },
              { label: "每张图片", value: "image" },
              { label: "每秒", value: "second" },
              { label: "每分钟", value: "minute" },
              { label: "每千字符", value: "1k_character" },
            ]}
            value={priceDraft.unit}
          />
          <TextField
            label="单价"
            onChange={(value) => setPriceDraft((current) => ({ ...current, unitPrice: value }))}
            type="number"
            value={priceDraft.unitPrice}
          />
          <Button disabled={priceSaving} onClick={() => void addPrice()} type="button">
            {priceSaving ? <LoaderCircle className="animate-spin" /> : <Plus />}
            添加
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>模型</TableHead>
              <TableHead>能力</TableHead>
              <TableHead>计费方式</TableHead>
              <TableHead>单价</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {prices.length ? (
              prices.map((price) => (
                <TableRow key={price.id}>
                  <TableCell>
                    <p className="font-medium">{price.model}</p>
                    <p className="text-xs text-muted-foreground">{price.provider}</p>
                  </TableCell>
                  <TableCell>{price.capability}</TableCell>
                  <TableCell>{price.unit}</TableCell>
                  <TableCell>{price.unitPrice}</TableCell>
                  <TableCell>
                    <Button
                      aria-label="删除价格"
                      onClick={() => void deletePrice(price.id)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell className="text-center text-muted-foreground" colSpan={5}>
                  尚未配置模型价格
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </SettingsSection>
    </form>
  );
}

function SettingsSection({
  children,
  description,
  title,
}: React.PropsWithChildren<{ description: string; title: string }>) {
  return (
    <section className="grid gap-4 border-b pb-8 last:border-b-0 last:pb-0">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function ToggleField({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-9 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      <span>{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} size="sm" />
    </label>
  );
}

function TextField({
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        className="h-9"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        step={type === "number" ? "0.000001" : undefined}
        type={type}
        value={value}
      />
    </div>
  );
}

function SecretField({
  configured,
  label,
  onChange,
  value,
}: {
  configured: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-xs">{label}</Label>
        {configured ? <Badge variant="outline">已配置</Badge> : null}
      </div>
      <Input
        autoComplete="new-password"
        className="h-9"
        onChange={(event) => onChange(event.target.value)}
        placeholder={configured ? "留空保留，填写则替换" : "请输入密钥"}
        type="password"
        value={value}
      />
    </div>
  );
}

function ProviderFields({
  callback,
  children,
  clientId,
  configured,
  enabled,
  name,
  onClientIdChange,
  onEnabledChange,
  onSecretChange,
  secret,
}: React.PropsWithChildren<{
  callback?: string;
  clientId: string;
  configured: boolean;
  enabled: boolean;
  name: string;
  onClientIdChange: (value: string) => void;
  onEnabledChange: (checked: boolean) => void;
  onSecretChange: (value: string) => void;
  secret: string;
}>) {
  return (
    <div className="grid gap-3 border-l-2 pl-4">
      <ToggleField checked={enabled} disabled={false} label={`启用 ${name}`} onChange={onEnabledChange} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={`${name} Client ID`} onChange={onClientIdChange} value={clientId} />
        <SecretField configured={configured} label={`${name} Client Secret`} onChange={onSecretChange} value={secret} />
        {children}
      </div>
      <p className="break-all text-xs text-muted-foreground">回调地址：{callback || "-"}</p>
    </div>
  );
}

function SelectField({
  label,
  onChange,
  options,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  placeholder?: string;
  value: string;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Select onValueChange={(next) => next && onChange(next)} value={value}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

async function readJson(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.message === "string" ? payload.message : "请求失败");
  }
  return payload;
}

function readableError(error: unknown) {
  const code = error instanceof Error ? error.message : "请求失败";
  return (
    {
      AUTH_PROVIDER_REQUIRED: "至少保留一种登录方式",
      SMTP_CONFIGURATION_REQUIRED: "启用邮箱验证码前请填写 SMTP 主机、端口和发件地址",
      SMTP_PASSWORD_REQUIRED: "SMTP 用户名需要配套密码或 Token",
      GITHUB_CONFIGURATION_REQUIRED: "启用 GitHub 前请填写 Client ID 和 Client Secret",
      LINUXDO_CONFIGURATION_REQUIRED: "启用 LinuxDO 前请填写 Client ID 和 Client Secret",
      EPAY_CONFIGURATION_REQUIRED: "启用易支付前请补全网关、商户信息和支付方式",
    } as Record<string, string>
  )[code] ?? code;
}
