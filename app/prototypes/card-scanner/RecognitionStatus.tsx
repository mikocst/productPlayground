"use client";

import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import type { CardIdentity, Recognition } from "./types";

type Props = {
  recognition: Recognition;
  onOpen: (card: CardIdentity) => void;
  onChoose: (name: string) => void;
  onDismiss: () => void;
};

const MotionDiv = motion.create("div");
const quiet = "border border-border bg-card text-foreground hover:bg-muted";

function Suggestions({ names, onChoose }: { names: string[]; onChoose: (name: string) => void }) {
  if (!names.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Suggested cards">
      {names.map((name) => (
        <li key={name}>
          <Button onClick={() => onChoose(name)} className={quiet}>{name}</Button>
        </li>
      ))}
    </ul>
  );
}

function Body({ recognition, onOpen, onChoose, onDismiss }: Props) {
  switch (recognition.phase) {
    case "reading":
      return <p>Reading card name…</p>;
    case "resolving":
      return <p>Looking up “{recognition.query}”…</p>;
    case "confirm":
      return (
        <>
          <p>
            Read “{recognition.read}”. Is this <strong>{recognition.card.name}</strong>?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onOpen(recognition.card)}>Open {recognition.card.name}</Button>
            <Button onClick={onDismiss} className={quiet}>Scan again</Button>
          </div>
          <Suggestions names={recognition.suggestions} onChoose={onChoose} />
        </>
      );
    case "no-match":
      return (
        <>
          <p>
            {recognition.read ? <>No card matched “{recognition.read}”.</> : "No readable name was found."} Reduce glare,
            keep the name inside the dashed band, or type the name.
          </p>
          <Suggestions names={recognition.suggestions} onChoose={onChoose} />
          <Button onClick={onDismiss} className={quiet}>Dismiss</Button>
        </>
      );
    case "error":
      return (
        <>
          <p>{recognition.message}</p>
          <Button onClick={onDismiss} className={quiet}>Dismiss</Button>
        </>
      );
    default:
      return null;
  }
}

export function RecognitionStatus(props: Props) {
  const { phase } = props.recognition;
  const alert = phase === "error" || phase === "no-match";
  return (
    <AnimatePresence initial={false}>
      {phase !== "idle" && (
        <MotionDiv
          key="status"
          role={alert ? "alert" : "status"}
          aria-live="polite"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="overflow-hidden"
        >
          <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
            <Body {...props} />
          </div>
        </MotionDiv>
      )}
    </AnimatePresence>
  );
}
