"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type MouseEvent } from "react";
import type { ComboCard } from "./types";

type Props = { card: ComboCard | null; onClose: () => void };

const MotionDialog = motion.create("dialog");

/**
 * Full-screen native dialog showing one card. Clicking or tapping anywhere except the card closes it, as
 * does Escape. Fades in/out with easeOut (no scale, which keeps the card crisp); dialog.close() runs after the exit animation.
 */
export function CardModal({ card, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = card !== null;
  const src = card?.largeImage ?? card?.image ?? null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    if (!(event.target instanceof HTMLImageElement)) onClose();
  }

  return (
    <AnimatePresence>
      {card && (
        <MotionDialog
          ref={dialogRef}
          aria-label={card.name}
          onClick={handleClick}
          onCancel={(event) => {
            event.preventDefault();
            onClose();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onAnimationComplete={(definition) => {
            if (definition === "exit" && dialogRef.current?.open) dialogRef.current.close();
          }}
          className="fixed inset-0 m-0 flex h-dvh max-h-none w-full max-w-none items-center justify-center bg-background/85 p-6 backdrop:bg-transparent"
        >
          <button type="button" onClick={onClose} className="sr-only">Close</button>
          {/* No scale animation: a transformed layer can be rasterized soft; the dialog's fade is enough. */}
          <div className="relative aspect-63/88 w-[min(88vw,24rem)] max-h-[85dvh]">
            {src ? (
              <Image
                src={src}
                alt={card.name}
                fill
                unoptimized
                sizes="(max-width: 640px) 88vw, 384px"
                className="rounded-[4.75%/3.4%] object-contain shadow-2xl"
              />
            ) : (
              <p className="flex size-full items-center justify-center rounded-xl bg-card p-6 text-center text-sm text-muted-foreground">
                No image for {card.name}
              </p>
            )}
          </div>
        </MotionDialog>
      )}
    </AnimatePresence>
  );
}
