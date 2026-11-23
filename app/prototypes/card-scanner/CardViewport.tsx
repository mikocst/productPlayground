"use client";

import Image from "next/image";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/hydration";
import { cn } from "@/lib/utils";
import { DRAG_TILT, GYRO_TILT, HOVER_TILT, SWIPE_DISTANCE, TILT_SPRING } from "./data";
import type { Printing } from "./types";

type Props = {
  printing: Printing;
  cardName: string;
  direction: number;
  resetSignal: number;
  onPrev: () => void;
  onNext: () => void;
};

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

const MotionDiv = motion.create("div");
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));
const quiet = "border border-border bg-card text-foreground hover:bg-muted";

function Face({ src, alt, back }: { src: string | null; alt: string; back?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={cn("absolute inset-0 overflow-hidden rounded-[4.75%/3.4%] bg-muted backface-hidden", back && "rotate-y-180")}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          unoptimized
          draggable={false}
          sizes="(max-width: 640px) 80vw, 320px"
          onLoad={() => setLoaded(true)}
          className={cn("select-none object-contain transition-opacity duration-200 ease-out", loaded ? "opacity-100" : "opacity-0")}
        />
      ) : (
        <p className="flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground">No image for this printing</p>
      )}
    </div>
  );
}

export function CardViewport({ printing, cardName, direction, resetSignal, onPrev, onNext }: Props) {
  const reduced = useReducedMotion() ?? false;
  const hydrated = useHydrated();
  const tiltX = useMotionValue(0);
  const tiltY = useMotionValue(0);
  const flip = useMotionValue(0);
  const springX = useSpring(tiltX, TILT_SPRING);
  const springY = useSpring(tiltY, TILT_SPRING);
  const springFlip = useSpring(flip, TILT_SPRING);
  const rotateY = useTransform(() => springY.get() + springFlip.get());
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const gyroBase = useRef<number | null>(null);
  const resetKey = `${printing.id}:${resetSignal}`;
  const [face, setFaceState] = useState({ key: resetKey, back: false });
  const flipped = face.key === resetKey && face.back;
  const [gyro, setGyro] = useState<"off" | "on" | "denied">("off");

  const twoFaced = printing.faces.length > 1;
  const gyroAvailable = hydrated && !reduced && typeof window !== "undefined" && "DeviceOrientationEvent" in window && window.matchMedia("(pointer: coarse)").matches;

  function setTilt(x: number, y: number, instant = reduced) {
    tiltX.set(x);
    tiltY.set(y);
    if (instant) {
      springX.jump(x);
      springY.jump(y);
    }
  }

  function setFace(back: boolean) {
    setFaceState({ key: resetKey, back });
    flip.set(back ? 180 : 0);
    if (reduced) springFlip.jump(back ? 180 : 0);
  }

  // Reset rotation when the parent asks or the printing changes; `flipped` resets via resetKey.
  useEffect(() => {
    tiltX.set(0);
    tiltY.set(0);
    flip.set(0);
    springFlip.jump(0);
  }, [resetKey, tiltX, tiltY, flip, springFlip]);

  useEffect(() => {
    if (gyro !== "on") return;
    gyroBase.current = null;
    const handle = (event: DeviceOrientationEvent) => {
      if (drag.current || event.beta === null || event.gamma === null) return;
      gyroBase.current ??= event.beta;
      tiltX.set(clamp(-(event.beta - gyroBase.current), GYRO_TILT));
      tiltY.set(clamp(event.gamma, GYRO_TILT));
    };
    window.addEventListener("deviceorientation", handle);
    return () => {
      window.removeEventListener("deviceorientation", handle);
      tiltX.set(0);
      tiltY.set(0);
    };
  }, [gyro, tiltX, tiltY]);

  async function toggleGyro() {
    if (gyro === "on") return setGyro("off");
    const permission = (window.DeviceOrientationEvent as unknown as OrientationPermission).requestPermission;
    try {
      if (permission && (await permission()) !== "granted") return setGyro("denied");
      setGyro("on");
    } catch {
      setGyro("denied");
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (start && start.id === event.pointerId) {
      setTilt(clamp(-(event.clientY - start.y) / 4, DRAG_TILT), clamp((event.clientX - start.x) / 4, DRAG_TILT), false);
      return;
    }
    if (event.pointerType !== "mouse" || reduced || gyro === "on") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    setTilt(-py * 2 * HOVER_TILT, px * 2 * HOVER_TILT);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    drag.current = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    setTilt(0, 0);
    if (Math.abs(dx) > SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) onNext();
      else onPrev();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") onPrev();
    else if (event.key === "ArrowRight") onNext();
    else if (event.key.toLowerCase() === "f" && twoFaced) setFace(!flipped);
    else return;
    event.preventDefault();
  }

  const slide = reduced ? 0 : 36;
  const faceName = (index: number) => printing.faces[index]?.name || cardName;

  return (
    <div className="space-y-3">
      <div
        role="group"
        tabIndex={0}
        aria-roledescription="3D card"
        aria-label={`${faceName(flipped ? 1 : 0)}, ${printing.setName}. Drag to tilt, swipe or use arrow keys to change printing${twoFaced ? ", F to flip" : ""}.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => { if (!drag.current && gyro !== "on") setTilt(0, 0); }}
        onKeyDown={onKeyDown}
        className="mx-auto w-full max-w-[18rem] cursor-grab touch-pan-y select-none rounded-[4.75%/3.4%] perspective-distant outline-offset-4 active:cursor-grabbing"
      >
        <MotionDiv style={{ rotateX: springX, rotateY }} className="relative aspect-63/88 w-full shadow-2xl transform-3d rounded-[4.75%/3.4%]">
          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            <MotionDiv
              key={printing.id}
              custom={direction}
              variants={{
                enter: (d: number) => ({ x: d * slide, opacity: 0 }),
                center: { x: 0, opacity: 1 },
                exit: (d: number) => ({ x: -d * slide, opacity: 0 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="absolute inset-0 transform-3d"
            >
              <Face src={printing.faces[0]?.image ?? null} alt={`${faceName(0)} — ${printing.setName}`} />
              {twoFaced && <Face back src={printing.faces[1]?.image ?? null} alt={`${faceName(1)} — ${printing.setName}`} />}
            </MotionDiv>
          </AnimatePresence>
        </MotionDiv>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {twoFaced && (
          <Button onClick={() => setFace(!flipped)} className={quiet} aria-pressed={flipped}>
            {flipped ? "Show front" : "Flip card"}
          </Button>
        )}
        <Button onClick={() => { setTilt(0, 0); setFace(false); }} className={quiet}>Reset view</Button>
        {gyroAvailable && (
          <Button onClick={toggleGyro} className={quiet} aria-pressed={gyro === "on"} disabled={gyro === "denied"}>
            {gyro === "denied" ? "Motion blocked" : gyro === "on" ? "Motion tilt on" : "Motion tilt"}
          </Button>
        )}
      </div>
    </div>
  );
}
