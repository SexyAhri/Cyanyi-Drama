"use client";

import { useId } from "react";
import { AudioLines, MicVocal, VolumeX } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { SoundPolicy } from "@/lib/production-configuration/contract";
import { ConfigurationField } from "./fields";
import { ConfigurationHelp } from "./field-help";
import type { ProductionCopy } from "./copy";

export function SoundEditor({
  sound,
  patch,
  onChange,
  source,
  copy,
}: {
  sound: SoundPolicy;
  patch: Pick<Partial<SoundPolicy>, "mode">;
  onChange: (patch: Pick<Partial<SoundPolicy>, "mode">) => void;
  source: (field: string) => string;
  copy: ProductionCopy;
}) {
  const modeId = useId();
  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      <ConfigurationField
        label={copy.mode}
        source={source("sound.mode")}
        overridden={"mode" in patch}
        onInherit={() => {
          onChange({});
        }}
        copy={copy}
        help={
          <ConfigurationHelp label={copy.soundHelpLabel}>
            {copy.soundHelp}
          </ConfigurationHelp>
        }
      >
        <RadioGroup
          aria-label={copy.mode}
          value={sound.mode}
          onValueChange={(value) => {
            if (value === "native" || value === "post" || value === "silent")
              onChange({ mode: value });
          }}
          className="gap-3 lg:grid-cols-3"
        >
          {(
            [
              {
                value: "native",
                Icon: AudioLines,
                description: copy.soundModeNativeHelp,
              },
              {
                value: "post",
                Icon: MicVocal,
                description: copy.soundModePostHelp,
              },
              {
                value: "silent",
                Icon: VolumeX,
                description: copy.soundModeSilentHelp,
              },
            ] as const
          ).map(({ value, Icon, description }) => (
            <label
              key={value}
              htmlFor={`${modeId}-${value}`}
              className={`flex min-h-32 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${sound.mode === value ? "border-primary bg-primary/5" : "bg-background hover:bg-muted/50"}`}
            >
              <RadioGroupItem
                id={`${modeId}-${value}`}
                value={value}
                className="mt-1"
              />
              <span className="min-w-0">
                <Icon
                  aria-hidden="true"
                  className="mb-3 size-5 text-muted-foreground"
                />
                <span className="block text-sm font-medium">{copy[value]}</span>
                <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">
                  {description}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </ConfigurationField>
    </div>
  );
}
