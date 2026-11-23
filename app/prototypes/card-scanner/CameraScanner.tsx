"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { artRect } from "@/lib/cards/art-hash";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadArtIndex, mergeCandidates, searchArt, type ArtIndex } from "./artIndex";
import { decidePhoto, EMPTY_VOTES, recordFrame, type Decision, type VoteState } from "./autoScan";
import { AUTO_TICK_MS, CARD_RATIO, FRAME_HEIGHT, MIN_TEXTURE, MOVING_DIFF, SCENE_CHANGE_DIFF, SHARPNESS_RATIO } from "./data";
import {
  coarsePlacements,
  containedCard,
  coverToSource,
  frameQuality,
  guideFrame,
  hashPlacements,
  meanAbsDiff,
  refinePlacements,
  sampleGray,
  type Rect,
} from "./scanner";
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

type Loop = {
  previous: Uint8ClampedArray | null;
  motion: number;
  maxSharpness: number;
  votes: VoteState;
  surfacedScene: Uint8ClampedArray | null;
};

const CAMERA_MESSAGES: Partial<Record<CameraStatus, string>> = {
  denied: "Camera access was blocked. Allow it in your browser's site settings, upload a photo, or type the name.",
  unsupported: "The camera needs a secure (HTTPS) page and a browser that supports it. Upload a photo or type the name instead.",
  error: "The camera couldn't start. Close other apps using it and retry, or upload a photo.",
};

const HINTS: Record<ScanHint, string> = {
  loading: "Loading card index…",
  searching: "Fill the frame with the card",
  moving: "Hold the card still",
  matching: "Matching…",
  surfaced: "Show a different card to scan again",
};

const FRAME_SAMPLE = { width: 36, height: 50 };
const SHARP_SAMPLE = { width: 96, height: 64 };
const COARSE = coarsePlacements();

/** Coarse grid search, then a finer search (with slight tilts) around the best placement. */
function matchFrame(index: ArtIndex, context: CanvasRenderingContext2D, source: CanvasImageSource, card: Rect): ArtCandidate[] {
  const coarse = searchArt(index, hashPlacements(context, source, card, COARSE));
  const refinedAround = COARSE[coarse.bestQuery];
  const fine = searchArt(index, hashPlacements(context, source, card, refinePlacements(refinedAround)));
  return mergeCandidates(coarse.candidates, fine.candidates);
}

export function CameraScanner({ paused, onReading, onOpen, onConfirm, onMiss, onFailure }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const indexRef = useRef<ArtIndex | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const propsRef = useRef({ paused, onOpen, onConfirm, onMiss, onFailure });
  const hintRef = useRef<ScanHint>("loading");
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [hint, setHintState] = useState<ScanHint>("loading");
  const [indexState, setIndexState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    propsRef.current = { paused, onOpen, onConfirm, onMiss, onFailure };
  }, [paused, onOpen, onConfirm, onMiss, onFailure]);

  const setHint = useCallback((next: ScanHint) => {
    if (hintRef.current === next) return;
    hintRef.current = next;
    setHintState(next);
  }, []);

  const present = useCallback((decision: Decision) => {
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

  // Load the artwork index (cached by the browser after the first visit).
  useEffect(() => {
    let active = true;
    loadArtIndex()
      .then((index) => {
        if (!active) return;
        indexRef.current = index;
        setIndexState("ready");
      })
      .catch(() => { if (active) setIndexState("error"); });
    return () => { active = false; };
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

  // Auto-scan loop: every sharp, non-moving frame is hashed at several card placements and matched
  // against the artwork index; votes across frames decide (autoScan.ts).
  useEffect(() => {
    if (status !== "live" || indexState !== "ready") return;
    const sampleContext = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const hashContext = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!sampleContext || !hashContext) return;
    let cancelled = false;
    let timer = 0;
    const loop: Loop = { previous: null, motion: 0, maxSharpness: 0, votes: EMPTY_VOTES, surfacedScene: null };
    setHint("searching");

    const step = (video: HTMLVideoElement, index: ArtIndex) => {
      const element = { width: video.clientWidth, height: video.clientHeight };
      if (!element.width || !element.height) return;
      const frame = coverToSource(guideFrame(element.width, element.height), element, { width: video.videoWidth, height: video.videoHeight });
      const frameGray = sampleGray(sampleContext, video, frame, FRAME_SAMPLE.width, FRAME_SAMPLE.height);

      const diff = loop.previous ? meanAbsDiff(loop.previous, frameGray) : 0;
      loop.previous = frameGray;
      loop.motion = loop.motion * 0.5 + diff * 0.5;

      // After a guess was offered, wait for a different scene rather than re-matching the same card.
      if (loop.surfacedScene) {
        if (meanAbsDiff(loop.surfacedScene, frameGray) <= SCENE_CHANGE_DIFF) return setHint("surfaced");
        loop.surfacedScene = null;
        loop.votes = EMPTY_VOTES;
        loop.maxSharpness = 0;
      }
      if (loop.motion > MOVING_DIFF) return setHint("moving");

      const quality = frameQuality(sampleGray(sampleContext, video, artRect(frame), SHARP_SAMPLE.width, SHARP_SAMPLE.height), SHARP_SAMPLE.width, SHARP_SAMPLE.height);
      // Flat scenes (an empty table) hash to near-random bits that can resemble flat artwork.
      if (quality.texture < MIN_TEXTURE) return setHint("searching");
      loop.maxSharpness = Math.max(quality.sharpness, loop.maxSharpness * 0.97);
      if (quality.sharpness < loop.maxSharpness * SHARPNESS_RATIO) return;

      const candidates = matchFrame(index, hashContext, video, frame);
      const { state, decision } = recordFrame(loop.votes, candidates);
      loop.votes = state;
      if (decision.kind === "wait") return setHint(decision.leading ? "matching" : "searching");
      loop.surfacedScene = frameGray;
      loop.votes = EMPTY_VOTES;
      setHint("surfaced");
      present(decision);
    };

    const tick = () => {
      const video = videoRef.current;
      const index = indexRef.current;
      if (video && index && video.videoWidth && !document.hidden && !propsRef.current.paused) {
        try {
          step(video, index);
        } catch {
          // A transient canvas failure skips this frame.
        }
      }
      if (!cancelled) timer = window.setTimeout(tick, AUTO_TICK_MS);
    };
    timer = window.setTimeout(tick, AUTO_TICK_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [status, indexState, present, setHint]);

  async function upload(file: File | undefined) {
    if (!file) return;
    onReading();
    try {
      const [index, bitmap] = await Promise.all([loadArtIndex(), createImageBitmap(file)]);
      const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("canvas");
      const candidates = matchFrame(index, context, bitmap, containedCard({ width: bitmap.width, height: bitmap.height }));
      bitmap.close();
      present(decidePhoto(candidates));
    } catch {
      onFailure("That image couldn't be matched. Try a JPEG or PNG photo of the card front, or type the name.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const live = status === "live";
  const message = CAMERA_MESSAGES[status];
  const locked = live && !paused && hint === "matching";
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
