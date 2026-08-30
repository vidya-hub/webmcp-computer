import { useEffect, useRef, useState } from "react";
import type { Computer } from "@webmcp-computer/contract";
import { play } from "../sound.ts";
import { prefersReducedMotion } from "./motion.ts";

const OPENING = [
  "post ......... ok",
  "memory ....... ok",
  "vnc :1 ....... ok",
  "desktop ...... starting",
];

export function ComputerBoot({ computer }: { computer: Computer }) {
  const starting = computer.status === "starting";
  const [phase, setPhase] = useState<"in" | "out" | "off">(
    starting ? "in" : "off",
  );
  const [lines, setLines] = useState<string[]>(() =>
    starting && !prefersReducedMotion() ? [] : [...OPENING, "waiting for desktop…"],
  );
  const started = useRef(false);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (starting) {
      setPhase("in");
      if (!started.current) {
        started.current = true;
        play("start");
      }
      return;
    }
    if (phase !== "in") return;
    play(computer.status === "error" ? "error" : "complete");
    if (computer.status === "error") {
      setLines((ls) => [...ls, "bridge not healthy"]);
    }
    setPhase("out");
    // phase is intentionally not a dep: this must run once when status leaves
    // "starting", then the out→off timer lives in the effect below.
  }, [computer.status, starting]);

  useEffect(() => {
    if (phase !== "out") return;
    const ms = reduced || computer.status !== "error" ? (reduced ? 0 : 380) : 1000;
    const t = window.setTimeout(() => setPhase("off"), ms);
    return () => window.clearTimeout(t);
  }, [phase, reduced, computer.status]);

  useEffect(() => {
    if (!starting || reduced) return;
    let i = 0;
    const timers: number[] = [];
    const tick = () => {
      if (i < OPENING.length) {
        const line = OPENING[i]!;
        i += 1;
        setLines((ls) => [...ls, line]);
        timers.push(window.setTimeout(tick, 180));
        return;
      }
      setLines((ls) => [...ls, "waiting for desktop…"]);
    };
    timers.push(window.setTimeout(tick, 80));
    timers.push(
      window.setTimeout(() => setLines((ls) => [...ls, "still waiting…"]), 5000),
    );
    timers.push(
      window.setTimeout(
        () => setLines((ls) => [...ls, "desktop taking longer than usual"]),
        15000,
      ),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [starting, reduced]);

  if (phase === "off") return null;
  return (
    <div className={`wm-boot${phase === "out" ? " out" : ""}`} aria-hidden>
      <div className="wm-boot-progress">
        <span />
      </div>
      <div className="wm-boot-log">
        <p>webmcp — {computer.name}</p>
        {lines.map((line, i) => (
          <p key={`${line}-${i}`}>{line}</p>
        ))}
        {starting ? (
          <p>
            <span className="bootseq-cursor" />
          </p>
        ) : null}
      </div>
    </div>
  );
}
