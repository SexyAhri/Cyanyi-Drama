"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  LayoutTemplate,
  Loader2,
  Mic,
  Paperclip,
  Plus,
  Square,
} from "lucide-react";

import { AudioVisualizer } from "@/components/ui/audio-visualizer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FilePreview } from "@/components/ui/file-preview";
import { Textarea } from "@/components/ui/textarea";
import { useAudioRecording } from "@/hooks/use-audio-recording";
import { useAutosizeTextArea } from "@/hooks/use-autosize-textarea";
import { cn } from "@/lib/utils";

import {
  composerModes,
  durationOptions,
  imageCountOptions,
  imageFormatOptions,
  imageQualityOptions,
  imageResolutionOptions,
  isAgentComposerMode,
  ratioOptions,
  setComposerMode,
  styleOptions,
  videoFormatOptions,
  videoResolutionOptions,
} from "./composer-data";
import { ComposerSelect } from "./composer-select";
import { TemplateGallery } from "./template-gallery";
import type {
  AgentComposerOption,
  AgentComposerSettings,
} from "./types";
import { useComposerTemplates } from "./use-composer-templates";

type AgentComposerProps = {
  allowInputWhileGenerating?: boolean;
  disabled?: boolean;
  imageModelOptions: AgentComposerOption[];
  isGenerating?: boolean;
  onChange: (value: string) => void;
  onSettingsChange: (settings: AgentComposerSettings) => void;
  onSubmit: () => void;
  placeholder?: string;
  settings: AgentComposerSettings;
  stop?: () => void;
  transcribeAudio?: (blob: Blob) => Promise<string>;
  value: string;
  videoModelOptions: AgentComposerOption[];
};

export function AgentComposer({
  allowInputWhileGenerating = false,
  disabled,
  imageModelOptions,
  isGenerating = false,
  onChange,
  onSettingsChange,
  onSubmit,
  placeholder = "Ask AI...",
  settings,
  stop,
  transcribeAudio,
  value,
  videoModelOptions,
}: AgentComposerProps) {
  const [files, setFiles] = useState<File[] | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [previewReferenceImage, setPreviewReferenceImage] = useState<string | null>(
    null,
  );
  const { isLoading: isLoadingTemplates, templates } = useComposerTemplates(
    settings.mode === "image" && showTemplates,
  );
  const textareaRef = useAutosizeComposer(
    value,
    files,
    settings.referenceImages.length,
  );
  const {
    audioStream,
    isListening,
    isRecording,
    isSpeechSupported,
    isTranscribing,
    stopRecording,
    toggleListening,
  } = useAudioRecording({
    transcribeAudio,
    onTranscriptionComplete: (text) => onChange(text),
  });

  const activePlaceholder = useMemo(() => {
    if (settings.mode === "image") {
      return "描述你想要的图片";
    }

    if (settings.mode === "video") {
      return "描述你想要的视频";
    }

    return placeholder;
  }, [placeholder, settings.mode]);

  const referenceImages =
    settings.mode === "video" ? [] : settings.referenceImages;
  const showReferenceImages = referenceImages.length > 0;

  function patchSettings(patch: Partial<AgentComposerSettings>) {
    onSettingsChange({
      ...settings,
      ...patch,
    });
  }

  async function addFiles(nextFiles: File[] | null) {
    if (!nextFiles?.length) {
      return;
    }

    const imageFiles =
      settings.mode === "video"
        ? undefined
        : nextFiles.filter((file) => file.type.startsWith("image/"));
    const remainingFiles = imageFiles?.length
      ? nextFiles.filter((file) => !imageFiles.includes(file))
      : nextFiles;

    if (imageFiles?.length) {
      const nextReferenceImages = await Promise.all(
        imageFiles.map((file) => createReferenceImageFromFile(file)),
      );
      patchSettings({
        referenceImage: undefined,
        referenceImages: dedupeReferenceImages([
          ...referenceImages,
          ...nextReferenceImages,
        ]),
      });
    }

    if (remainingFiles.length > 0) {
      setFiles((current) =>
        current ? [...current, ...remainingFiles] : remainingFiles,
      );
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!value.trim() || disabled || isGenerating) {
      return;
    }

    setFiles(null);
    onSubmit();
    onChange("");

    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "";
    }
  }

  return (
    <>
      <form className="w-full" onSubmit={handleSubmit}>
        {settings.mode === "image" && showTemplates ? (
          <TemplateGallery
            isLoading={isLoadingTemplates}
            onSelect={(template) => {
              const templateText =
                template.promptPreview ?? createShortTemplatePrompt(template);

              if (settings.template === template.id) {
                patchSettings({
                  template: "none",
                  templatePrompt: undefined,
                });

                if (value.trim() === templateText.trim()) {
                  onChange("");
                }

                return;
              }

              patchSettings({
                ratio: template.ratio,
                style: template.style ?? settings.style,
                template: template.id,
                templatePrompt: template.prompt,
              });

              onChange(templateText);
            }}
            selectedTemplateId={settings.template}
            templates={templates}
          />
        ) : null}

        <div className="w-full rounded-2xl border bg-card/90 p-2 shadow-lg shadow-primary/5 backdrop-blur">
          <div className="relative">
            <Textarea
              className={cn(
                "max-h-60 min-h-12 resize-none border-0 bg-transparent px-2 pb-2 pr-2 text-base shadow-none focus-visible:ring-0 md:text-sm",
              )}
              disabled={disabled || (isGenerating && !allowInputWhileGenerating)}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              onPaste={(event) => {
                const clipboardFiles = Array.from(event.clipboardData.items)
                  .map((item) => item.getAsFile())
                  .filter((file): file is File => file !== null);

                if (clipboardFiles.length > 0) {
                  void addFiles(clipboardFiles);
                }
              }}
              placeholder={activePlaceholder}
              ref={textareaRef}
              value={value}
            />

            {showReferenceImages || files?.length ? (
              <div className="flex gap-2 overflow-x-auto px-2 pb-2">
                {referenceImages.map((referenceImage, index) => (
                  <FilePreview
                    contentType={referenceImage?.mimeType ?? "image/png"}
                    key={referenceImage.url + String(index)}
                    name={getReferenceImageFileName(referenceImage, index)}
                    onPreview={() => setPreviewReferenceImage(referenceImage.url)}
                    onRemove={() =>
                      patchSettings({
                        referenceImage: undefined,
                        referenceImages: referenceImages.filter(
                          (_, imageIndex) => imageIndex !== index,
                        ),
                      })
                    }
                    previewUrl={referenceImage?.url}
                  />
                ))}
                {files?.map((file) => (
                  <FilePreview
                    file={file}
                    key={file.name + String(file.lastModified)}
                    onRemove={() =>
                      setFiles((current) => {
                        const next =
                          current?.filter((item) => item !== file) ?? [];
                        return next.length ? next : null;
                      })
                    }
                  />
                ))}
              </div>
            ) : null}

            <RecordingOverlay
              audioStream={audioStream}
              isRecording={isRecording}
              isTranscribing={isTranscribing}
              onStopRecording={stopRecording}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <Button
                aria-label="Add attachment"
                className="h-8 px-2"
                onClick={async () => {
                  await addFiles(await showFileUploadDialog(settings.mode));
                }}
                type="button"
                variant="ghost"
              >
                <Plus />
              </Button>
              <ComposerSelect
                active
                onClear={() =>
                  patchSettings({
                    mode: "chat",
                    template: "none",
                    templatePrompt: undefined,
                  })
                }
                onValueChange={(mode) => {
                  if (isAgentComposerMode(mode)) {
                    onSettingsChange(setComposerMode({
                      ...settings,
                      ...(mode !== "image"
                        ? { template: "none", templatePrompt: undefined }
                        : {}),
                    }, mode));
                  }
                }}
                options={composerModes}
                value={settings.mode}
              />

              {settings.mode === "image" ? (
                <>
                  <ComposerSelect
                    onValueChange={(imageModel) => patchSettings({ imageModel })}
                    options={imageModelOptions}
                    value={settings.imageModel}
                  />
                  <ComposerSelect
                    label="比例"
                    onValueChange={(ratio) =>
                      patchSettings({ imageRatio: ratio, ratio })
                    }
                    options={ratioOptions}
                    value={settings.imageRatio}
                  />
                  <ComposerSelect
                    label="分辨率"
                    onValueChange={(resolution) =>
                      patchSettings({ imageResolution: resolution, resolution })
                    }
                    options={imageResolutionOptions}
                    value={settings.imageResolution}
                  />
                  <ComposerSelect
                    label="数量"
                    onValueChange={(count) =>
                      patchSettings({ imageCount: Number(count) })
                    }
                    options={imageCountOptions}
                    value={String(settings.imageCount)}
                  />
                  <ComposerSelect
                    label="质量"
                    onValueChange={(imageQuality) =>
                      patchSettings({ imageQuality })
                    }
                    options={imageQualityOptions}
                    value={settings.imageQuality}
                  />
                  <ComposerSelect
                    label="格式"
                    onValueChange={(imageFormat) => patchSettings({ imageFormat })}
                    options={imageFormatOptions}
                    value={settings.imageFormat}
                  />
                  <ComposerSelect
                    label="风格"
                    onValueChange={(style) => patchSettings({ style })}
                    options={styleOptions}
                    value={settings.style}
                  />
                  <Button
                    className={cn(
                      "h-8 gap-1 rounded-lg px-2 text-sm",
                      showTemplates &&
                        "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                    )}
                    onClick={() => setShowTemplates((current) => !current)}
                    type="button"
                    variant={
                      settings.template === "none" ? "ghost" : "secondary"
                    }
                  >
                    <LayoutTemplate />
                    <span>模板</span>
                  </Button>
                </>
              ) : null}

              {settings.mode === "video" ? (
                <>
                  <ComposerSelect
                    onValueChange={(videoModel) => patchSettings({ videoModel })}
                    options={videoModelOptions}
                    value={settings.videoModel}
                  />
                  <ComposerSelect
                    label="时长"
                    onValueChange={(duration) =>
                      patchSettings({ duration, videoDuration: duration })
                    }
                    options={durationOptions}
                    value={settings.videoDuration}
                  />
                  <ComposerSelect
                    label="比例"
                    onValueChange={(ratio) =>
                      patchSettings({ ratio, videoRatio: ratio })
                    }
                    options={ratioOptions}
                    value={settings.videoRatio}
                  />
                  <ComposerSelect
                    label="分辨率"
                    onValueChange={(resolution) =>
                      patchSettings({ resolution, videoResolution: resolution })
                    }
                    options={videoResolutionOptions}
                    value={settings.videoResolution}
                  />
                  <ComposerSelect
                    label="格式"
                    onValueChange={(videoFormat) => patchSettings({ videoFormat })}
                    options={videoFormatOptions}
                    value={settings.videoFormat}
                  />
                </>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <Button
                aria-label="Attach a file"
                onClick={async () => {
                  await addFiles(await showFileUploadDialog(settings.mode));
                }}
                size="icon"
                type="button"
                variant="outline"
              >
                <Paperclip />
              </Button>
              {isSpeechSupported ? (
                <Button
                  aria-label="Voice input"
                  className={cn(isListening && "text-primary")}
                  onClick={toggleListening}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <Mic />
                </Button>
              ) : null}
              {isGenerating && stop ? (
                <Button aria-label="Stop generating" onClick={stop} size="icon">
                  <Square className="size-3 animate-pulse" fill="currentColor" />
                </Button>
              ) : (
                <Button
                  aria-label="Send message"
                  disabled={!value.trim() || disabled || isGenerating}
                  size="icon"
                  type="submit"
                >
                  <ArrowUp />
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>

      {previewReferenceImage ? (
        <Dialog
          onOpenChange={(open) => {
            if (!open) {
              setPreviewReferenceImage(null);
            }
          }}
          open={Boolean(previewReferenceImage)}
        >
          <DialogContent className="max-w-[calc(100vw-2rem)] border-none bg-black/82 p-0 shadow-none sm:max-w-[calc(100vw-6rem)]">
            <div className="flex max-h-[88vh] min-h-[60vh] items-center justify-center p-4 sm:p-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Reference image preview"
                className="max-h-[78vh] max-w-full rounded-2xl bg-white object-contain shadow-2xl"
                src={previewReferenceImage}
              />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function createShortTemplatePrompt(template: {
  description: string;
  title: string;
}) {
  return `参考“${template.title}”模板，生成一张图片，风格方向：${template.description}。`;
}

function useAutosizeComposer(
  value: string,
  files: File[] | null,
  referenceImageCount: number,
) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useAutosizeTextArea({
    ref,
    maxHeight: 240,
    borderWidth: 0,
    dependencies: [value, files?.length ?? 0, referenceImageCount],
  });

  return ref;
}

async function createReferenceImageFromFile(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  const dimensions = await readImageDimensions(dataUrl).catch(() => undefined);

  return {
    url: dataUrl,
    format: getImageFormatFromFile(file),
    height: dimensions?.height,
    mimeType: file.type || undefined,
    width: dimensions?.width,
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();

    image.onerror = reject;
    image.onload = () =>
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    image.src = src;
  });
}

function getImageFormatFromFile(file: File) {
  if (file.type.startsWith("image/")) {
    return file.type.replace("image/", "");
  }

  return file.name.split(".").pop()?.toLowerCase();
}

function getReferenceImageFileName(
  referenceImage: AgentComposerSettings["referenceImages"][number] | undefined,
  index: number,
) {
  const format = referenceImage?.format?.trim().toLowerCase() || "png";
  return `reference-${index + 1}.${format.replace(/^\./, "")}`;
}

function dedupeReferenceImages(referenceImages: AgentComposerSettings["referenceImages"]) {
  const seen = new Set<string>();

  return referenceImages.filter((referenceImage) => {
    const url = referenceImage.url?.trim();

    if (!url || seen.has(url)) {
      return false;
    }

    seen.add(url);
    return true;
  });
}

function RecordingOverlay({
  audioStream,
  isRecording,
  isTranscribing,
  onStopRecording,
}: {
  audioStream: MediaStream | null;
  isRecording: boolean;
  isTranscribing: boolean;
  onStopRecording: () => void;
}) {
  if (isRecording) {
    return (
      <div className="absolute inset-0 z-20 overflow-hidden rounded-xl">
        <AudioVisualizer
          isRecording={isRecording}
          onClick={onStopRecording}
          stream={audioStream}
        />
      </div>
    );
  }

  if (isTranscribing) {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-background/80 backdrop-blur-sm">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return null;
}

function showFileUploadDialog(mode: AgentComposerSettings["mode"]) {
  const input = document.createElement("input");

  input.accept = mode === "image" ? "image/*" : "*/*";
  input.multiple = true;
  input.type = "file";
  input.click();

  return new Promise<File[] | null>((resolve) => {
    input.onchange = (event) => {
      const files = (event.currentTarget as HTMLInputElement).files;
      resolve(files ? Array.from(files) : null);
    };
  });
}
