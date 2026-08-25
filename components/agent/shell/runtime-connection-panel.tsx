"use client";

import { Eye, EyeOff, KeyRound, PlugZap, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { ShellCopy } from "./chat-shell-i18n";
import type { RuntimeConnectionSettings } from "./chat-shell-types";
import { getRuntimeConnectionStatusLabel } from "./runtime-connection-status";

type RuntimeConnectionPanelProps = {
  copy: ShellCopy;
  onChange: (settings: RuntimeConnectionSettings) => void;
  onClear: () => void;
  onTestConnection: () => void;
  settings: RuntimeConnectionSettings;
};

export function RuntimeConnectionPanel({
  copy,
  onChange,
  onClear,
  onTestConnection,
  settings,
}: RuntimeConnectionPanelProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const isLoading = settings.status === "loading";

  return (
    <div className="grid gap-4 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">{copy.modelConnection}</h3>
          <p className="text-xs text-muted-foreground">
            {copy.modelConnectionDescription}
          </p>
        </div>
        <Badge variant={settings.status === "error" ? "destructive" : "outline"}>
          {getRuntimeConnectionStatusLabel(settings, copy)}
        </Badge>
      </div>

      {settings.status === "error" ? (
        <Alert variant="destructive">
          <PlugZap />
          <AlertTitle>{copy.connectionError}</AlertTitle>
          <AlertDescription>
            {settings.statusMessage || copy.connectionErrorDescription}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="runtime-base-url">{copy.baseUrl}</Label>
        <Input
          id="runtime-base-url"
          onChange={(event) =>
            onChange({
              ...settings,
              baseUrl: event.target.value,
              status: "idle",
              statusMessage: undefined,
            })
          }
          placeholder="https://api.openai.com/v1"
          value={settings.baseUrl}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="runtime-api-key">{copy.apiKey}</Label>
        <div className="flex gap-2">
          <Input
            className="min-w-0"
            id="runtime-api-key"
            onChange={(event) =>
              onChange({
                ...settings,
                apiKey: event.target.value,
                status: "idle",
                statusMessage: undefined,
              })
            }
            placeholder="sk-..."
            type={showApiKey ? "text" : "password"}
            value={settings.apiKey}
          />
          <Button
            aria-label={showApiKey ? copy.hideApiKey : copy.showApiKey}
            onClick={() => setShowApiKey((current) => !current)}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            {showApiKey ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          disabled={isLoading}
          onClick={onClear}
          type="button"
          variant="ghost"
        >
          <Trash2 />
          {copy.clearConnection}
        </Button>
        <div className="flex items-center gap-2">
          <Button
            disabled={isLoading}
            onClick={onTestConnection}
            type="button"
            variant="outline"
          >
            <RotateCcw className={isLoading ? "animate-spin" : undefined} />
            {copy.refreshModels}
          </Button>
          <Button
            disabled={isLoading}
            onClick={onTestConnection}
            type="button"
          >
            <KeyRound />
            {copy.testConnection}
          </Button>
        </div>
      </div>
    </div>
  );
}
