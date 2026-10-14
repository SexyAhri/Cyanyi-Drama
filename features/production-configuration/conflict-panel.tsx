"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProductionConfigurationPatch } from "@/lib/production-configuration/contract";
import {
  compareConfigurationEdits,
  mergeConfigurationEdits,
  type ConfigurationConflictChoice,
} from "@/lib/production-configuration/conflict-contract";
import type { ProductionCopy } from "./copy";
import { displayValue, fieldLabel } from "./configuration-display";

export function ProductionConflictPanel({
  copy,
  base,
  local,
  remote,
  revision,
  version,
  agentNames,
  busy,
  onRefresh,
  onMerge,
  onUseRemote,
}: {
  copy: ProductionCopy;
  base: ProductionConfigurationPatch;
  local: ProductionConfigurationPatch;
  remote: ProductionConfigurationPatch | null;
  revision?: number;
  version?: number;
  agentNames: Record<string, string>;
  busy: boolean;
  onRefresh: () => void;
  onMerge: (patch: ProductionConfigurationPatch) => void;
  onUseRemote: () => void;
}) {
  const [choices, setChoices] = useState<
    Record<string, ConfigurationConflictChoice>
  >({});
  const [mergeError, setMergeError] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    sectionRef.current?.focus();
  }, []);
  const changes = remote ? compareConfigurationEdits(base, local, remote) : [];
  const unresolved = changes.filter(
    (change) => change.resolution === "conflict" && !choices[change.field],
  ).length;
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label={copy.conflictTitle}
      className="min-w-0 space-y-4 rounded-lg border border-destructive/40 bg-muted/20 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{copy.conflictTitle}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {copy.conflictHelp}
        </p>
        {remote && (
          <p className="text-xs text-muted-foreground">
            {copy.conflictRemote} · {copy.version} v{version} ·{" "}
            {copy.conflictRevision} {revision}
          </p>
        )}
      </div>
      {remote && (
        <div className="space-y-3">
          {!changes.length && <p className="text-sm">{copy.sameDraft}</p>}
          {changes.map((change) => (
            <div
              key={change.field}
              className="min-w-0 space-y-3 rounded-md border bg-background p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h4 className="min-w-0 break-anywhere text-sm font-medium">
                  {fieldLabel(change.field, copy, agentNames)}
                </h4>
                <span
                  className={
                    change.resolution === "conflict"
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {change.resolution === "conflict"
                    ? copy.conflictChoose
                    : change.resolution === "local"
                      ? copy.conflictLocalOnly
                      : change.resolution === "remote"
                        ? copy.conflictRemoteOnly
                        : copy.conflictSame}
                </span>
              </div>
              <div className="grid min-w-0 gap-3 sm:grid-cols-3">
                {(["base", "local", "remote"] as const).map((side) => (
                  <div key={side} className="min-w-0 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {side === "base"
                        ? copy.conflictBase
                        : side === "local"
                          ? copy.conflictLocal
                          : copy.conflictRemote}
                    </p>
                    {change.fields.map((field, index) => (
                      <p key={field} className="whitespace-pre-wrap text-sm ">
                        {change.fields.length > 1 && (
                          <span className="text-muted-foreground">
                            {field.endsWith(".channelId")
                              ? copy.conflictChannel
                              : copy.model}
                            :{" "}
                          </span>
                        )}
                        {displayValue(field, change[side][index], copy)}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
              {change.resolution === "conflict" && (
                <Select
                  value={choices[change.field] ?? null}
                  disabled={busy}
                  onValueChange={(value) => {
                    if (value === "local" || value === "remote") {
                      setMergeError(false);
                      setChoices((current) => ({
                        ...current,
                        [change.field]: value,
                      }));
                    }
                  }}
                >
                  <SelectTrigger
                    aria-label={
                      fieldLabel(change.field, copy, agentNames) +
                      " · " +
                      copy.conflictChoose
                    }
                    className="h-10 min-h-10 w-full sm:w-56"
                  >
                    <SelectValue placeholder={copy.conflictChoose} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem className="min-h-10" value="local">
                      {copy.conflictKeepLocal}
                    </SelectItem>
                    <SelectItem className="min-h-10" value="remote">
                      {copy.conflictKeepRemote}
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          ))}
          <p role="status" className="text-xs text-muted-foreground">
            {copy.conflictRemaining}: {unresolved}
          </p>
        </div>
      )}
      {mergeError && (
        <p role="alert" className="text-sm text-destructive">
          {copy.conflictMergeFailed}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button
          variant="outline"
          className="min-h-10"
          disabled={busy}
          onClick={onRefresh}
        >
          {copy.conflictRefresh}
        </Button>
        <Button
          variant="outline"
          className="min-h-10"
          disabled={busy || !remote}
          onClick={onUseRemote}
        >
          {copy.conflictUseRemote}
        </Button>
        <Button
          className="min-h-10"
          disabled={busy || !remote || unresolved > 0}
          onClick={() => {
            if (!remote) return;
            try {
              onMerge(mergeConfigurationEdits(base, local, remote, choices));
            } catch {
              setMergeError(true);
            }
          }}
        >
          {copy.conflictMerge}
        </Button>
      </div>
    </section>
  );
}
