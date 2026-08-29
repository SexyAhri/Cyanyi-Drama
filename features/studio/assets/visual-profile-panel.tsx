import { Edit3, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { getStudioCopy } from "../i18n";
import type { StudioLocale, StudioModelOption } from "../types";
import type { StudioAssetEntity } from "./asset-view-model";
import { VisualDesignDialog } from "./visual-design-dialog";

export function VisualProfilePanel({
  artStyle,
  entity,
  locale,
  models,
  onCompleted,
  projectId,
}: {
  artStyle: string;
  entity: StudioAssetEntity;
  locale: StudioLocale;
  models: StudioModelOption[];
  onCompleted: () => Promise<unknown> | void;
  projectId: string;
}) {
  const copy = getStudioCopy(locale);
  const profile = entity.visualProfile;
  return (
    <section className="border-b py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{copy.visualDesign}</h3>
          <Badge variant={profile ? "secondary" : "outline"}>
            {profile
              ? profile.source === "manual"
                ? copy.manuallyEdited
                : copy.aiGenerated
              : copy.notDesigned}
          </Badge>
        </div>
        <VisualDesignDialog
          artStyle={artStyle}
          entity={entity}
          locale={locale}
          models={models}
          onCompleted={onCompleted}
          projectId={projectId}
          trigger={
            <Button size="sm" type="button" variant="outline">
              {profile ? (
                <Edit3 className="size-4" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {profile ? copy.editVisualDesign : copy.generateVisualDesign}
            </Button>
          }
        />
      </div>

      {profile ? (
        <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <ProfileValue label={copy.visualIdentity} value={profile.spec.visualIdentity} />
          <ProfileValue label={copy.colorPalette} value={profile.spec.colorPalette} />
          <ProfileValue label={copy.shapeAndStructure} value={profile.spec.shapeAndStructure} />
          <ProfileValue label={copy.surfaceAndStyling} value={profile.spec.surfaceAndStyling} />
          <ProfileValue
            label={copy.consistencyRules}
            value={profile.spec.consistencyRules.join("；")}
          />
          <ProfileValue label={copy.negativePrompt} value={profile.spec.negativePrompt} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {copy.noVisualDesign}
        </p>
      )}
    </section>
  );
}

function ProfileValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm leading-6">{value}</p>
    </div>
  );
}
