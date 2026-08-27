"use client";

import { LoaderCircle, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { createStudioDeliverable } from "../api";
import type {
  ProductionDeliverableCatalog,
  ProjectMediaAsset,
  StudioLocale,
} from "../types";
import { getProductionCopy, productionLabel } from "./copy";

export function DeliverableCreateDialog({
  catalog,
  defaultType,
  departments,
  episodeId,
  locale,
  onCompleted,
  projectId,
  sourceAssets,
  types,
}: {
  catalog: ProductionDeliverableCatalog;
  defaultType: string;
  departments: string[];
  episodeId?: string;
  locale: StudioLocale;
  onCompleted: () => Promise<unknown> | void;
  projectId: string;
  sourceAssets: ProjectMediaAsset[];
  types?: string[];
}) {
  const copy = getProductionCopy(locale);
  const [open, setOpen] = useState(false);
  const [deliverableType, setDeliverableType] = useState(defaultType);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [directives, setDirectives] = useState("");
  const [constraints, setConstraints] = useState("");
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [dependencyIds, setDependencyIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const availableTypes = useMemo(() => {
    const typeFilter = types ? new Set(types) : null;
    return catalog.departments
      .filter((department) => departments.includes(department.id))
      .flatMap((department) => department.deliverableTypes)
      .filter((type) => !typeFilter || typeFilter.has(type));
  }, [catalog.departments, departments, types]);
  const department = catalog.departments.find((candidate) =>
    candidate.deliverableTypes.includes(deliverableType),
  );

  useEffect(() => {
    if (availableTypes.includes(deliverableType)) return;
    setDeliverableType(
      availableTypes.includes(defaultType) ? defaultType : availableTypes[0] ?? "",
    );
  }, [availableTypes, defaultType, deliverableType]);

  function updateSelection(
    current: string[],
    id: string,
    checked: boolean,
    update: (value: string[]) => void,
  ) {
    update(
      checked
        ? [...new Set([...current, id])]
        : current.filter((item) => item !== id),
    );
  }

  async function submit() {
    if (!department || !deliverableType || !title.trim() || !summary.trim())
      return;
    setIsSubmitting(true);
    try {
      await createStudioDeliverable(projectId, {
        department: department.id,
        deliverableType,
        title: title.trim(),
        scopeType: episodeId ? "episode" : "project",
        scopeId: episodeId ?? projectId,
        episodeId,
        payload: {
          summary: summary.trim(),
          directives: toLines(directives),
          constraints: toLines(constraints),
        },
        sourceRefs: sourceIds.map((id) => ({ type: "media_asset", id })),
        dependencyIds,
      });
      toast.success(copy.created);
      setOpen(false);
      reset(defaultType);
      await onCompleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  function reset(type: string) {
    setDeliverableType(type);
    setTitle("");
    setSummary("");
    setDirectives("");
    setConstraints("");
    setSourceIds([]);
    setDependencyIds([]);
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && !isSubmitting) reset(defaultType);
      }}
      open={open}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        {copy.newDeliverable}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg sm:max-h-[min(92dvh,860px)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.newDeliverable}</DialogTitle>
          <DialogDescription className="sr-only">
            {copy.deliverables}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.type}
            <Select
              disabled={isSubmitting}
              onValueChange={(value) => value && setDeliverableType(value)}
              value={deliverableType}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue>
                  {productionLabel(locale, "types", deliverableType)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {availableTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {productionLabel(locale, "types", type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.title}
            <Input
              disabled={isSubmitting}
              maxLength={191}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={copy.titlePlaceholder}
              value={title}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.summary}
            <Textarea
              className="h-28 resize-y overflow-y-auto field-sizing-fixed"
              disabled={isSubmitting}
              maxLength={6_000}
              onChange={(event) => setSummary(event.target.value)}
              placeholder={copy.summaryPlaceholder}
              value={summary}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              {copy.directives}
              <Textarea
                className="h-28 resize-y overflow-y-auto field-sizing-fixed"
                disabled={isSubmitting}
                onChange={(event) => setDirectives(event.target.value)}
                placeholder={copy.directivesPlaceholder}
                value={directives}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {copy.constraints}
              <Textarea
                className="h-28 resize-y overflow-y-auto field-sizing-fixed"
                disabled={isSubmitting}
                onChange={(event) => setConstraints(event.target.value)}
                placeholder={copy.constraintsPlaceholder}
                value={constraints}
              />
            </label>
          </div>

          {catalog.deliverables.length ? (
            <fieldset>
              <legend className="text-sm font-medium">{copy.upstream}</legend>
              <div className="mt-2 max-h-40 divide-y overflow-y-auto border-y">
                {catalog.deliverables
                  .filter((item) => item.status !== "superseded")
                  .map((item) => (
                    <label
                      className="flex cursor-pointer items-center gap-3 px-2 py-2.5"
                      key={item.id}
                    >
                      <Checkbox
                        checked={dependencyIds.includes(item.id)}
                        disabled={isSubmitting}
                        onCheckedChange={(checked) =>
                          updateSelection(
                            dependencyIds,
                            item.id,
                            Boolean(checked),
                            setDependencyIds,
                          )
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-xs">
                        {item.title}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        v{item.version} ·{" "}
                        {productionLabel(locale, "statuses", item.status)}
                      </span>
                    </label>
                  ))}
              </div>
            </fieldset>
          ) : null}

          {sourceAssets.length ? (
            <fieldset>
              <legend className="text-sm font-medium">
                {copy.sourceAssets}
              </legend>
              <div className="mt-2 grid max-h-52 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-5">
                {sourceAssets.map((asset) => {
                  const checked = sourceIds.includes(asset.id);
                  return (
                    <label
                      className={cn(
                        "relative cursor-pointer overflow-hidden rounded-md border bg-muted/20",
                        checked && "border-foreground",
                      )}
                      key={asset.id}
                    >
                      <Checkbox
                        aria-label={copy.sourceAssets}
                        checked={checked}
                        className="absolute top-2 left-2 z-10 bg-background"
                        disabled={isSubmitting}
                        onCheckedChange={(next) =>
                          updateSelection(
                            sourceIds,
                            asset.id,
                            Boolean(next),
                            setSourceIds,
                          )
                        }
                      />
                      <div className="aspect-square">
                        {asset.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt={copy.sourceAssets}
                            className="size-full object-cover"
                            src={asset.url}
                          />
                        ) : null}
                      </div>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
        </div>
        <DialogFooter className="rounded-b-lg">
          <Button
            disabled={isSubmitting}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            {copy.cancel}
          </Button>
          <Button
            disabled={
              isSubmitting ||
              !department ||
              !deliverableType ||
              !title.trim() ||
              !summary.trim()
            }
            onClick={() => void submit()}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {copy.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeliverableRejectDialog({
  disabled,
  gateKey,
  locale,
  onReject,
}: {
  disabled: boolean;
  gateKey: string;
  locale: StudioLocale;
  onReject: (note: string) => Promise<void>;
}) {
  const copy = getProductionCopy(locale);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function submit() {
    if (!note.trim()) return;
    setIsSubmitting(true);
    try {
      await onReject(note.trim());
      setOpen(false);
      setNote("");
    } finally {
      setIsSubmitting(false);
    }
  }
  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button disabled={disabled} size="sm" variant="outline" />}>
        <X className="size-4" />
        {copy.reject}
      </DialogTrigger>
      <DialogContent className="rounded-lg sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.rejectionNote}</DialogTitle>
          <DialogDescription>
            {productionLabel(locale, "gates", gateKey)}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          className="h-28 resize-y overflow-y-auto field-sizing-fixed"
          disabled={isSubmitting}
          onChange={(event) => setNote(event.target.value)}
          placeholder={copy.rejectionPlaceholder}
          value={note}
        />
        <DialogFooter className="rounded-b-lg">
          <Button
            disabled={isSubmitting}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            {copy.cancel}
          </Button>
          <Button
            disabled={isSubmitting || !note.trim()}
            onClick={() => void submit()}
            type="button"
            variant="destructive"
          >
            {copy.reject}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeliverableConfirmDialog({
  description,
  disabled,
  icon,
  label,
  locale,
  onConfirm,
  variant = "default",
}: {
  description: string;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  locale: StudioLocale;
  onConfirm: () => Promise<void>;
  variant?: "default" | "outline";
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  const copy = getProductionCopy(locale);
  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <AlertDialogTrigger
        render={<Button disabled={disabled} size="sm" variant={variant} />}
      >
        {icon}
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>
            {copy.cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isSubmitting}
            onClick={async () => {
              setIsSubmitting(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function toLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
