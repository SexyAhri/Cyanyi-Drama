"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { StudioLocale } from "../types";

export type StudioConfirmation = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

export function useStudioConfirmation(locale: StudioLocale) {
  const [request, setRequest] = useState<StudioConfirmation | null>(null);
  const resolve = useRef<((confirmed: boolean) => void) | null>(null);
  const finish = useCallback((confirmed: boolean) => {
    resolve.current?.(confirmed);
    resolve.current = null;
    setRequest(null);
  }, []);
  useEffect(() => () => {
    resolve.current?.(false);
    resolve.current = null;
  }, []);
  const confirm = useCallback((next: StudioConfirmation) => {
    resolve.current?.(false);
    return new Promise<boolean>(done => {
      resolve.current = done;
      setRequest(next);
    });
  }, []);
  const confirmationDialog = <StudioConfirmationDialog locale={locale} request={request} onResolve={finish} />;
  return { confirm, confirmationDialog };
}

export function StudioConfirmationDialog({ locale, request, onResolve }: {
  locale: StudioLocale;
  request: StudioConfirmation | null;
  onResolve: (confirmed: boolean) => void;
}) {
  return (
    <AlertDialog open={Boolean(request)} onOpenChange={open => { if (!open) onResolve(false); }}>
      <AlertDialogContent className="max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] overflow-y-auto bg-[var(--canvas)] shadow-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">{request?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{request?.cancelLabel ?? (locale === "en" ? "Cancel" : "取消")}</AlertDialogCancel>
          <AlertDialogAction variant={request?.destructive ? "destructive" : "default"} onClick={() => onResolve(true)}>
            {request?.confirmLabel ?? (locale === "en" ? "Confirm and continue" : "确认并继续")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
