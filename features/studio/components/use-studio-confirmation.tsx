"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { StudioLocale } from "../types";

type Confirmation = { title: string; description: string; confirmLabel?: string };

export function useStudioConfirmation(locale: StudioLocale) {
  const [request, setRequest] = useState<Confirmation | null>(null);
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
  const confirm = useCallback((next: Confirmation) => {
    resolve.current?.(false);
    return new Promise<boolean>(done => {
      resolve.current = done;
      setRequest(next);
    });
  }, []);
  const confirmationDialog = (
    <AlertDialog open={Boolean(request)} onOpenChange={open => { if (!open) finish(false); }}>
      <AlertDialogContent className="max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">{request?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{locale === "en" ? "Cancel" : "取消"}</AlertDialogCancel>
          <AlertDialogAction onClick={() => finish(true)}>
            {request?.confirmLabel ?? (locale === "en" ? "Confirm and continue" : "确认并继续")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { confirm, confirmationDialog };
}
