import { useEffect, useRef, useState } from "react";
import type { Computer } from "@webmcp-computer/contract";
import { play } from "../sound.ts";
import { prefersReducedMotion } from "./motion.ts";

const OPENING = ["post ......... ok", "memory ....... ok", "vnc :1 ....... ok", "desktop ...... starting"];

export function ComputerBoot({ computer }: { computer: Computer }) {
  const [phase, setPhase] = useState<"in" | "out" | "off">(
    computer.status === "starting" ? "in" : "off",
  );
  const [lines, setLines] = useState<string[]>(() =>
    prefersReducedMotion() || computer.status !== "starting" ? [...OPENING, "waiting for desktop…"] : [],
  );
  const started = useRef(false);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (computer.status === "starting") {
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
      const hold = window.setTimeout(() => setPhase("out"), reduced ? 0 : 600);
      const hide = window.setTimeout(() => setPhase("off"), reduced ? 0 : 1000);
      return () => {
        window.clearTimeout(hold);
        window.clearTimeout(hide);
      };
    }
    setPhase("out");
    const t = window.setTimeout(() => setPhase("off"), reduced ? 0 : 380);
    return () => window.clearTimeout(t);
  }, [computer.status, phase, reduced]);

  useEffect(() => {
    if (computer.status !== "starting" || reduced) return;
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
      window.setTimeout(() => setLines((ls) => [...ls, "desktop taking longer than usual"]), 15000),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [computer.status, reduced]);

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
        {computer.status === "starting" ? (
          <p>
            <span className="bootseq-cursor" />
          </p>
        ) : null}
      </div>
    </div>
  );
}
