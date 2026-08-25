"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

type InterruptPromptProps = {
  isOpen: boolean;
  close: () => void;
};

export function InterruptPrompt({ isOpen, close }: InterruptPromptProps) {
  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          animate={{
            top: -40,
            filter: "blur(0px)",
            transition: {
              type: "spring",
              filter: { type: "tween" },
            },
          }}
          className="absolute left-1/2 flex -translate-x-1/2 overflow-hidden whitespace-nowrap rounded-full border bg-background py-1 text-center text-sm text-muted-foreground"
          exit={{ top: 0, filter: "blur(5px)" }}
          initial={{ top: 0, filter: "blur(5px)" }}
        >
          <span className="ml-2.5">Press Enter again to interrupt</span>
          <button
            aria-label="Close"
            className="ml-1 mr-2.5 flex items-center"
            onClick={close}
            type="button"
          >
            <X className="h-3 w-3" />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
