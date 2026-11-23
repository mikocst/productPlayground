"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Worker } from "tesseract.js";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AUTO_TICK_MS,
  CARD_RATIO,
  FRAME_HEIGHT,
  MAX_SCENE_ATTEMPTS,
  MIN_BAND_EDGES,
  NAME_BAND,
  RETRY_DELAY_MS,
  SCENE_CHANGE_DIFF,
  STABLE_DIFF,
  STABLE_TICKS,
} from "./data";
import {
  containedCard,
  coverToSource,
  createOcrWorker,
  edgeDensity,
  guideFrame,
  meanAbsDiff,
  prepareNameBand,
  readNameBand,
  sampleGray,
  subRegion,
  type Rect,
} from "./scanner";
import type { CameraStatus, ScanHint, ScanOutcome } from "./types";

type Props = {
  /** True while the parent is showing a result, confirmation, or error — auto-scan waits. */
  paused: boolean;
  onReading: () => void;
  /** `quiet` reads come from auto-scan: misses should not surface UI. */
  onRead: (candidates: string[], raw: string, quiet: boolean) => Promise<ScanOutcome>;
  onFailure: (message: string) => void;
};

type ScanState = {
  previous: Uint8ClampedArray | null;
  stableTicks: number;
  attempts: number;
  missScene: Uint8ClampedArray | null;
  cooldownUntil: number;
};

const CAMERA_MESSAGES: Partial<Record<CameraStatus, string>> = {
  denied: "Camera access was blocked. Allow it in your browser's site settings, upload a photo, or type the name.",
  unsupported: "This browser can't open the camera here. Camera access needs HTTPS (or localhost). Upload a photo or type the name instead.",
  error: "The camera couldn't start. Close other apps using it and retry, or upload a photo.",
};

const HINTS: Record<ScanHint, string> = {
  searching: "Fit the card in the frame with its name in the dashed band",
  steady: "Hold steady…",
  reading: "Reading card name…",
  retry: "Couldn't read the name. Tilt slightly to cut glare.",
};

const FRAME_SAMPLE = { width: 36, height: 50 };
const BAND_SAMPLE = { width: 160, height: 14 };

export function CameraScanner({ paused, onReading, onRead, onFailure }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Promise<Worker> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const pausedRef = useRef(paused);
  const onReadRef = useRef(onRead);
  const onFailureRef = useRef(onFailure);
  const hintRef = useRef<ScanHint>("searching");
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [hint, setHintState] = useState<ScanHint>("searching");
  const [loadingModel, setLoadingModel] = useState(false);

  useEffect(() => {
    pausedRef.current = paused;
    onReadRef.current = onRead;
    onFailureRef.current = onFailure;
  }, [paused, onRead, onFailure]);

  const setHint = useCallback((next: ScanHint) => {
    if (hintRef.current === next) return;
    hintRef.current = next;
    setHintState(next);
  }, []);

  const getWorker = useCallback((): Promise<Worker> => {
    if (!workerRef.current) {
      setLoadingModel(true);
      const pending = createOcrWorker().finally(() => { if (mountedRef.current) setLoadingModel(false); });
      pending.catch(() => { workerRef.current = null; });
      workerRef.current = pending;
    }
    return workerRef.current;
  }, []);

  /** OCR the name band of `source`. Returns null when nothing name-like was read. */
  const readBand = useCallback(async (source: CanvasImageSource, band: Rect) => {
    const canvases = prepareNameBand(source, band);
    if (!canvases.length) throw new Error("canvas");
    const worker = await getWorker();
    return readNameBand(worker, canvases);
  }, [getWorker]);

  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setStatus("unsupported");
      return;
    }
    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      setStatus("live");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "unsupported" : "error");
    }
  }, []);

  // Lifecycle: stop the stream and OCR worker on unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      workerRef.current?.then((worker) => worker.terminate()).catch(() => {});
    };
  }, []);

  // Skip the Start tap when camera permission was already granted on a previous visit.
  useEffect(() => {
    let active = true;
    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((permission) => { if (active && permission.state === "granted") startCamera(); })
      .catch(() => {});
    return () => { active = false; };
  }, [startCamera]);

  // Auto-scan loop: sample the guide frame, wait for a steady card with text in the name band, then OCR.
  useEffect(() => {
    if (status !== "live") return;
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!context) return;
    let cancelled = false;
    let timer = 0;
    const scan: ScanState = { previous: null, stableTicks: 0, attempts: 0, missScene: null, cooldownUntil: 0 };

    const step = async (video: HTMLVideoElement) => {
      const element = { width: video.clientWidth, height: video.clientHeight };
      if (!element.width || !element.height) return;
      const frame = coverToSource(guideFrame(element.width, element.height), element, { width: video.videoWidth, height: video.videoHeight });
      const band = subRegion(frame);
      const frameGray = sampleGray(context, video, frame, FRAME_SAMPLE.width, FRAME_SAMPLE.height);
      const bandGray = sampleGray(context, video, band, BAND_SAMPLE.width, BAND_SAMPLE.height);

      const motion = scan.previous ? meanAbsDiff(scan.previous, frameGray) : 255;
      scan.previous = frameGray;
      if (scan.missScene && meanAbsDiff(scan.missScene, frameGray) > SCENE_CHANGE_DIFF) {
        scan.missScene = null;
        scan.attempts = 0;
      }

      const hasText = edgeDensity(bandGray, BAND_SAMPLE.width, BAND_SAMPLE.height) >= MIN_BAND_EDGES;
      scan.stableTicks = hasText && motion < STABLE_DIFF ? scan.stableTicks + 1 : 0;
      const exhausted = scan.attempts >= MAX_SCENE_ATTEMPTS;

      if (!hasText) return setHint("searching");
      if (exhausted) return setHint("retry");
      if (scan.stableTicks < STABLE_TICKS) return setHint(scan.attempts > 0 ? "retry" : "steady");
      if (Date.now() < scan.cooldownUntil) return;

      // The last attempt on a scene is not quiet, so its miss surfaces suggestions.
      const quiet = scan.attempts < MAX_SCENE_ATTEMPTS - 1;
      setHint("reading");
      inFlightRef.current = true;
      try {
        const { candidates, raw } = await readBand(video, band);
        if (cancelled) return;
        if (!candidates.length) {
          scan.cooldownUntil = Date.now() + RETRY_DELAY_MS;
          return setHint("steady");
        }
        const outcome = await onReadRef.current(candidates, raw.split("\n")[0] ?? "", quiet);
        if (outcome === "miss") {
          scan.attempts++;
          scan.missScene = frameGray;
          scan.stableTicks = 0;
          scan.cooldownUntil = Date.now() + RETRY_DELAY_MS;
          setHint("retry");
        }
      } catch {
        if (!cancelled) onFailureRef.current("Text recognition couldn't run on this device. Upload a photo or type the card name.");
      } finally {
        inFlightRef.current = false;
      }
    };

    const tick = async () => {
      const video = videoRef.current;
      if (video && video.videoWidth && !document.hidden && !pausedRef.current && !inFlightRef.current) {
        await step(video);
      }
      if (!cancelled) timer = window.setTimeout(tick, AUTO_TICK_MS);
    };

    // Warm the OCR model while the user lines up the card.
    getWorker().catch(() => {});
    timer = window.setTimeout(tick, AUTO_TICK_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [status, getWorker, readBand, setHint]);

  async function upload(file: File | undefined) {
    if (!file) return;
    onReading();
    try {
      const bitmap = await createImageBitmap(file);
      const { candidates, raw } = await readBand(bitmap, subRegion(containedCard({ width: bitmap.width, height: bitmap.height })));
      bitmap.close();
      await onRead(candidates, raw.split("\n")[0] ?? "", false);
    } catch {
      onFailure("That image couldn't be read. Try a JPEG or PNG photo of the card front.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const live = status === "live";
  const message = CAMERA_MESSAGES[status];
  const locked = live && !paused && (hint === "steady" || hint === "reading");
  const pill = loadingModel && hint === "reading" ? "Loading text recognition…" : HINTS[hint];

  return (
    <section aria-label="Card camera" className="space-y-3">
      <div className="relative mx-auto aspect-3/4 max-h-[62vh] w-full overflow-hidden rounded-xl border border-border bg-muted">
        <video
          ref={videoRef}
          playsInline
          muted
          className={cn("absolute inset-0 size-full object-cover", !live && "invisible")}
        />
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[4.5%/3.2%] border-2 transition-colors duration-150 ease-out",
            locked ? "border-primary-bright" : "border-foreground/70",
          )}
          style={{ height: `${FRAME_HEIGHT * 100}%`, aspectRatio: String(CARD_RATIO) }}
        >
          <div
            className={cn(
              "absolute rounded-sm border border-dashed transition-colors duration-150 ease-out",
              locked ? "border-primary-bright bg-primary/15" : "border-foreground/60 bg-foreground/10",
            )}
            style={{ left: `${NAME_BAND.x * 100}%`, top: `${NAME_BAND.y * 100}%`, width: `${NAME_BAND.width * 100}%`, height: `${NAME_BAND.height * 100}%` }}
          />
        </div>
        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            {message ? (
              <p role="alert" className="max-w-xs rounded-lg bg-card/90 p-3 text-sm">{message}</p>
            ) : (
              <p className="max-w-xs rounded-lg bg-card/90 p-3 text-sm text-muted-foreground">Point the camera at a card. It scans automatically.</p>
            )}
            <Button onClick={startCamera} disabled={status === "starting"}>
              {status === "starting" ? "Opening camera…" : message ? "Retry camera" : "Start camera"}
            </Button>
          </div>
        )}
        {live && !paused && (
          <p aria-live="polite" className="absolute inset-x-3 bottom-3 rounded-lg bg-card/90 p-2 text-center text-sm">
            {pill}
          </p>
        )}
      </div>
      <Button onClick={() => fileRef.current?.click()} disabled={paused} className="w-full border border-border bg-card text-foreground hover:bg-muted">
        Upload photo
      </Button>
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => upload(event.target.files?.[0])} />
    </section>
  );
}
