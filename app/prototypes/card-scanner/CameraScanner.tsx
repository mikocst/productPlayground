"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Worker } from "tesseract.js";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CARD_RATIO, FRAME_HEIGHT, NAME_BAND } from "./data";
import { containedCard, coverToSource, createOcrWorker, guideFrame, prepareNameBand, readNameBand, subRegion } from "./scanner";
import type { CameraStatus } from "./types";

type Props = {
  busy: boolean;
  onReading: () => void;
  onRead: (candidates: string[], raw: string) => void;
  onFailure: (message: string) => void;
};

const CAMERA_MESSAGES: Partial<Record<CameraStatus, string>> = {
  denied: "Camera access was blocked. Allow it in your browser's site settings, upload a photo, or type the name.",
  unsupported: "This browser can't open the camera here. Camera access needs HTTPS (or localhost). Upload a photo or type the name instead.",
  error: "The camera couldn't start. Close other apps using it and retry, or upload a photo.",
};

export function CameraScanner({ busy, onReading, onRead, onFailure }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Promise<Worker> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [loadingModel, setLoadingModel] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => {
    stopStream();
    workerRef.current?.then((worker) => worker.terminate()).catch(() => {});
  }, [stopStream]);

  async function startCamera() {
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
  }

  function getWorker(): Promise<Worker> {
    if (!workerRef.current) {
      setLoadingModel(true);
      workerRef.current = createOcrWorker().finally(() => setLoadingModel(false));
      workerRef.current.catch(() => { workerRef.current = null; });
    }
    return workerRef.current;
  }

  async function read(source: CanvasImageSource, band: ReturnType<typeof subRegion>) {
    onReading();
    try {
      const canvases = prepareNameBand(source, band);
      if (!canvases.length) throw new Error("canvas");
      const worker = await getWorker();
      const { candidates, raw } = await readNameBand(worker, canvases);
      onRead(candidates, raw);
    } catch {
      onFailure("Text recognition couldn't run on this device. Type the card name instead.");
    }
  }

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const element = { width: video.clientWidth, height: video.clientHeight };
    const frame = coverToSource(guideFrame(element.width, element.height), element, { width: video.videoWidth, height: video.videoHeight });
    video.pause();
    await read(video, subRegion(frame));
    if (streamRef.current) video.play().catch(() => {});
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const card = containedCard({ width: bitmap.width, height: bitmap.height });
      await read(bitmap, subRegion(card));
      bitmap.close();
    } catch {
      onFailure("That image couldn't be read. Try a JPEG or PNG photo of the card front.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const live = status === "live";
  const message = CAMERA_MESSAGES[status];
  const working = busy || loadingModel;

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
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[4.5%/3.2%] border-2 border-foreground/70"
          style={{ height: `${FRAME_HEIGHT * 100}%`, aspectRatio: String(CARD_RATIO) }}
        >
          <div
            className="absolute rounded-sm border border-dashed border-foreground/60 bg-foreground/10"
            style={{ left: `${NAME_BAND.x * 100}%`, top: `${NAME_BAND.y * 100}%`, width: `${NAME_BAND.width * 100}%`, height: `${NAME_BAND.height * 100}%` }}
          />
        </div>
        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            {message ? (
              <p role="alert" className="max-w-xs rounded-lg bg-card/90 p-3 text-sm">{message}</p>
            ) : (
              <p className="max-w-xs rounded-lg bg-card/90 p-3 text-sm text-muted-foreground">Fit the card in the frame with its name in the dashed band.</p>
            )}
            <Button onClick={startCamera} disabled={status === "starting"}>
              {status === "starting" ? "Opening camera…" : message ? "Retry camera" : "Start camera"}
            </Button>
          </div>
        )}
        {live && working && (
          <p aria-live="polite" className="absolute inset-x-3 bottom-3 rounded-lg bg-card/90 p-2 text-center text-sm">
            {loadingModel ? "Loading text recognition…" : "Reading card name…"}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={capture} disabled={!live || working}>Capture</Button>
        <Button onClick={() => fileRef.current?.click()} disabled={working} className="border border-border bg-card text-foreground hover:bg-muted">
          Upload photo
        </Button>
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => upload(event.target.files?.[0])} />
      </div>
    </section>
  );
}
