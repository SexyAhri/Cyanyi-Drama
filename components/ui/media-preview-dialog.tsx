"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function MediaPreviewDialog({
  alt,
  description,
  kind,
  onOpenChange,
  open,
  title,
  url,
}: {
  alt: string;
  description: string;
  kind: "image" | "video";
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
  url: string;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden border-none bg-black/92 p-0 shadow-2xl [&_[data-slot=dialog-close]]:bg-black/45 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:hover:bg-white/15 sm:w-[calc(100vw-4rem)] sm:max-w-[calc(100vw-4rem)]">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex h-[min(82vh,56rem)] min-h-64 items-center justify-center p-2 sm:p-6">
          {kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={alt}
              className="max-h-full max-w-full object-contain"
              src={url}
            />
          ) : (
            <video
              aria-label={alt}
              className="max-h-full max-w-full"
              controls
              playsInline
              preload="metadata"
              src={url}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
