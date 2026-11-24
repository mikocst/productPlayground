"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { decidePhoto, EMPTY_SCAN, recordFrame, type Decision, type ScanState } from "./autoScan";
import type { Decision as V1Decision } from "./autoScanV1";
import { CARD_RATIO, FRAME_HEIGHT, FRAME_INTERVAL_MS, MAX_FRAME_HEIGHT } from "./data";
import { coverToSource, cropAround, guideFrame, sourceToCover } from "./geometry";
import { ScanDebug, type DebugStats } from "./ScanDebug";
import { ScanSession, type Engine, type IndexInfo } from "./scanEngine";
import type { ArtCandidate, CameraStatus, ScanHint } from "./types";

type Props = {
  /** True while the parent shows a result, confirmation, or error. Auto-scan waits. */
  paused: boolean;
  onReading: () => void;
  onOpen: (match: ArtCandidate) => void;
  onConfirm: (match: ArtCandidate, others: string[]) => void;
  onMiss: (others: string[]) => void;
  onFailure: (message: string) => void;
};

const CAMERA_MESSAGES: Partial<Record<CameraStatus, string>> = {
  denied: "Camera access was blocked. Allow it in your browser's site settings, upload a photo, or type the name.",
  unsupported: "The camera needs a secure (HTTPS) page and a browser that supports it. Upload a photo or type the name instead.",
  error: "The camera couldn't start. Close other apps using it and retry, or upload a photo.",
};

const HINTS: Record<ScanHint, string> = {
  loading: "Loading card index…",
  searching: "Hold a card inside the frame",
  moving: "Hold the card still",
  matching: "Matching…",
  glare: "Tilt the card to cut the glare",
  surfaced: "Show a different card to scan again",
};

/** Longest side an uploaded photo is reduced to before matching. */
const PHOTO_SIZE = 1280;
/** A card just opened stays blocked this long across remounts, so "Scan" doesn't reopen it at once. */
const CARRY_BLOCK_MS = 60_000;
let carried: { nameIndex: number; at: number } | null = null;

export function CameraScanner({ paused, onReading, onOpen, onConfirm, onMiss, onFailure }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<ScanSession | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const propsRef = useRef({ paused, onOpen, onConfirm, onMiss, onFailure });
  const hintRef = useRef<ScanHint>("loading");
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [hint, setHintState] = useState<ScanHint>("loading");
  const [indexState, setIndexState] = useState<"loading" | "ready" | "error">("loading");
  // URL flags are read after mount so the server and first client render match.
  const [flags, setFlags] = useState<{ engine: Engine; debug: boolean } | null>(null);
  const [info, setInfo] = useState<IndexInfo | null>(null);
  const [stats, setStats] = useState<DebugStats | null>(null);

  useEffect(() => {
    propsRef.current = { paused, onOpen, onConfirm, onMiss, onFailure };
  }, [paused, onOpen, onConfirm, onMiss, onFailure]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const timer = window.setTimeout(() => setFlags({ engine: params.get("scanner") === "v1" ? "v1" : "v2", debug: params.get("debug") === "1" }), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const setHint = useCallback((next: ScanHint) => {
    if (hintRef.current === next) return;
    hintRef.current = next;
    setHintState(next);
  }, []);

  const present = useCallback((decision: Decision | V1Decision) => {
    const { onOpen: open, onConfirm: confirm, onMiss: miss } = propsRef.current;
    if (decision.kind === "open") open(decision.match);
    else if (decision.kind === "confirm") confirm(decision.match, decision.others);
    else if (decision.kind === "surface") miss(decision.others);
  }, []);

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
      // Continuous autofocus where supported (Chrome on Android); ignored elsewhere.
      const [track] = stream.getVideoTracks();
      track?.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  // One worker session per mount; the worker loads (or already holds) the index.
  useEffect(() => {
    if (!flags) return;
    const session = new ScanSession(flags.engine);
    sessionRef.current = session;
    let active = true;
    session
      .ready()
      .then((loaded) => {
        if (!active) return;
        setInfo(loaded);
        setIndexState("ready");
      })
      .catch(() => { if (active) setIndexState("error"); });
    return () => {
      active = false;
      session.close();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [flags]);

  // Skip the Start tap when camera permission was already granted on a previous visit.
  useEffect(() => {
    let active = true;
    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((permission) => { if (active && permission.state === "granted") startCamera(); })
      .catch(() => {});
    return () => { active = false; };
  }, [startCamera]);

  // Frame loop: every FRAME_INTERVAL_MS, if the worker is idle, crop the guide area (plus a margin), post it,
  // and feed the result to the decision rules. A busy worker makes the tick a no-op.
  useEffect(() => {
    const session = sessionRef.current;
    if (status !== "live" || indexState !== "ready" || !session || !flags) return;
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!context) return;
    let cancelled = false;
    const recent = carried && Date.now() - carried.at < CARRY_BLOCK_MS ? carried : null;
    let state: ScanState = recent ? { ...EMPTY_SCAN, blocked: { nameIndex: recent.nameIndex, misses: 0 } } : EMPTY_SCAN;
    const replies: number[] = [];
    setHint("searching");

    const tick = async () => {
      const video = videoRef.current;
      if (!video || !video.videoWidth || session.busy || document.hidden || propsRef.current.paused) return;
      const element = { width: video.clientWidth, height: video.clientHeight };
      const source = { width: video.videoWidth, height: video.videoHeight };
      if (!element.width || !element.height) return;
      const guide = coverToSource(guideFrame(element.width, element.height), element, source);
      const crop = cropAround(guide, source);
      const scale = Math.min(1, MAX_FRAME_HEIGHT / crop.height);
      const width = Math.round(crop.width * scale);
      const height = Math.round(crop.height * scale);
      let frame: ImageData;
      try {
        if (context.canvas.width !== width || context.canvas.height !== height) {
          context.canvas.width = width;
          context.canvas.height = height;
        }
        context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
        frame = context.getImageData(0, 0, width, height);
      } catch {
        return; // a transient canvas failure skips this frame
      }
      const guideInFrame = { x: (guide.x - crop.x) * scale, y: (guide.y - crop.y) * scale, width: guide.width * scale, height: guide.height * scale };
      let reply;
      try {
        reply = await session.analyze(frame, guideInFrame);
      } catch {
        return;
      }
      if (!reply || cancelled || propsRef.current.paused) return;

      const now = performance.now();
      replies.push(now);
      while (replies.length && now - replies[0] > 1000) replies.shift();

      if (reply.engine === "v1") {
        setHint(reply.result.hint);
        if (flags.debug) setStats({ ms: reply.ms, fps: replies.length, best: reply.result.best?.name ?? null, distance: reply.result.best?.distance ?? null, runnerUp: null, source: "v1", quad: null, certain: null });
        if (reply.result.decision) present(reply.result.decision);
        return;
      }

      const { analysis } = reply;
      const next = recordFrame(state, analysis, now);
      state = next.state;
      carried = state.blocked ? { nameIndex: state.blocked.nameIndex, at: Date.now() } : null;
      if (flags.debug) {
        // Quad corners: frame pixels → video pixels → element pixels, for the overlay.
        const quad = analysis.quad
          ? Array.from({ length: 4 }, (_, i) => sourceToCover(analysis.quad![i * 2] / scale + crop.x, analysis.quad![i * 2 + 1] / scale + crop.y, element, source))
          : null;
        setStats({
          ms: analysis.ms,
          fps: replies.length,
          best: analysis.best?.name ?? null,
          distance: analysis.best?.distance ?? null,
          runnerUp: analysis.runnerUp ? `${analysis.runnerUp.name} (${analysis.runnerUp.distance})` : null,
          source: `${analysis.source}${analysis.confident ? " · confident" : ""} · ${analysis.outlines} outlines`,
          quad,
          certain: analysis.best ? `${analysis.best.set.toUpperCase()} #${analysis.best.collector}${analysis.best.printingCertain ? "" : " (guess)"}` : null,
        });
      }
      if (next.decision.kind === "wait") return setHint(next.decision.hint);
      setHint("surfaced");
      present(next.decision);
    };

    const timer = window.setInterval(tick, FRAME_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status, indexState, flags, present, setHint]);

  async function upload(file: File | undefined) {
    const session = sessionRef.current;
    if (!file || !session) return;
    onReading();
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, PHOTO_SIZE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("canvas");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const reply = await session.photo(context.getImageData(0, 0, canvas.width, canvas.height));
      if (!reply) return;
      present(reply.engine === "v2" ? decidePhoto(reply.analysis) : reply.decision);
    } catch {
      onFailure("That image couldn't be matched. Try a JPEG or PNG photo of the card front, or type the name.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const live = status === "live";
  const message = CAMERA_MESSAGES[status];
  const locked = live && !paused && (hint === "matching" || hint === "glare");
  const pill = indexState === "error" ? "The card index couldn't load. Type the card name below." : HINTS[indexState === "loading" ? "loading" : hint];

  return (
    <section aria-label="Card camera" className="space-y-3">
      <div className="relative mx-auto aspect-3/4 max-h-[62vh] w-full overflow-hidden rounded-xl border border-border bg-muted">
        <video ref={videoRef} playsInline muted className={cn("absolute inset-0 size-full object-cover", !live && "invisible")} />
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[4.5%/3.2%] border-2 transition-colors duration-150 ease-out",
            locked ? "border-primary-bright" : "border-foreground/70",
          )}
          style={{ height: `${FRAME_HEIGHT * 100}%`, aspectRatio: String(CARD_RATIO) }}
        />
        {flags?.debug && live && <ScanDebug stats={stats} info={info} engine={flags.engine} />}
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
      <Button onClick={() => fileRef.current?.click()} disabled={paused || indexState !== "ready"} className="w-full border border-border bg-card text-foreground hover:bg-muted">
        Upload photo
      </Button>
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => upload(event.target.files?.[0])} />
    </section>
  );
}
