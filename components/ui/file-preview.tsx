"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { motion } from "framer-motion";
import { FileIcon, X } from "lucide-react";

import { MediaPreviewDialog } from "@/components/ui/media-preview-dialog";
import { cn } from "@/lib/utils";

type FilePreviewProps = {
  file?: File;
  contentType?: string;
  name?: string;
  onRemove?: () => void;
  onPreview?: () => void;
  previewUrl?: string;
};

export function FilePreview(props: FilePreviewProps) {
  const contentType = props.file?.type ?? props.contentType ?? "";

  if (contentType.startsWith("image/")) {
    return <ImageFilePreview {...props} />;
  }

  if (
    contentType.startsWith("text/") ||
    props.file?.name.endsWith(".txt") ||
    props.file?.name.endsWith(".md") ||
    props.name?.endsWith(".txt") ||
    props.name?.endsWith(".md")
  ) {
    return <TextFilePreview {...props} />;
  }

  return <GenericFilePreview {...props} />;
}

function PreviewShell({
  children,
  className,
}: ComponentPropsWithoutRef<typeof motion.div>) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative flex max-w-[200px] rounded-md border p-1.5 pr-7 text-xs",
        className,
      )}
      exit={{ opacity: 0, y: "100%" }}
      initial={{ opacity: 0, y: "100%" }}
      layout
    >
      {children}
    </motion.div>
  );
}

function RemoveButton({ onRemove }: Pick<FilePreviewProps, "onRemove">) {
  if (!onRemove) {
    return null;
  }

  return (
    <button
      aria-label="Remove attachment"
      className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border/80 bg-background/95 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
      onClick={onRemove}
      type="button"
    >
      <X className="h-3 w-3" />
    </button>
  );
}

function ImageFilePreview({
  file,
  name,
  onPreview,
  onRemove,
  previewUrl,
}: FilePreviewProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const resolvedName = file?.name ?? name ?? "image";
  const generatedUrl = useMemo(() => {
    if (!file || previewUrl) {
      return null;
    }

    return URL.createObjectURL(file);
  }, [file, previewUrl]);
  const resolvedUrl = previewUrl ?? generatedUrl ?? "";

  useEffect(() => {
    return () => {
      if (generatedUrl) {
        URL.revokeObjectURL(generatedUrl);
      }
    };
  }, [generatedUrl]);

  function handlePreview() {
    if (onPreview) {
      onPreview();
      return;
    }

    setPreviewOpen(true);
  }

  const previewContent = (
    <div className="flex w-full items-center space-x-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={`Attachment ${resolvedName}`}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border bg-muted object-cover"
        src={resolvedUrl}
      />
      <span className="w-full truncate text-muted-foreground">
        {resolvedName}
      </span>
    </div>
  );

  return (
    <>
      <PreviewShell>
        <button
          aria-label={`Preview attachment ${resolvedName}`}
          className="w-full cursor-zoom-in text-left"
          onClick={handlePreview}
          type="button"
        >
          {previewContent}
        </button>
        <RemoveButton onRemove={onRemove} />
      </PreviewShell>

      {!onPreview && resolvedUrl ? (
        <MediaPreviewDialog
          alt={`Preview ${resolvedName}`}
          description={`Full-size preview of ${resolvedName}`}
          kind="image"
          onOpenChange={setPreviewOpen}
          open={previewOpen}
          title={`Preview ${resolvedName}`}
          url={resolvedUrl}
        />
      ) : null}
    </>
  );
}

function TextFilePreview({ file, onRemove }: FilePreviewProps) {
  const [preview, setPreview] = useState("");

  useEffect(() => {
    if (!file) {
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      const text = event.target?.result;

      if (typeof text === "string") {
        setPreview(text.slice(0, 50) + (text.length > 50 ? "..." : ""));
      }
    };

    reader.readAsText(file);
  }, [file]);

  return (
    <PreviewShell>
      <div className="flex w-full items-center space-x-2">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border bg-muted p-0.5">
          <div className="h-full w-full overflow-hidden text-[6px] leading-none text-muted-foreground">
            {preview || "Loading..."}
          </div>
        </div>
        <span className="w-full truncate text-muted-foreground">
          {file?.name ?? "text"}
        </span>
      </div>
      <RemoveButton onRemove={onRemove} />
    </PreviewShell>
  );
}

function GenericFilePreview({ file, onRemove }: FilePreviewProps) {
  return (
    <PreviewShell>
      <div className="flex w-full items-center space-x-2">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border bg-muted">
          <FileIcon className="h-6 w-6 text-foreground" />
        </div>
        <span className="w-full truncate text-muted-foreground">
          {file?.name ?? "file"}
        </span>
      </div>
      <RemoveButton onRemove={onRemove} />
    </PreviewShell>
  );
}
