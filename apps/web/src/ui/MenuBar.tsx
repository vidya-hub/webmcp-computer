import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { store, useStore } from "../store/index.ts";
import { selectMenuBar } from "../store/selectors.ts";

function clockTime(d: Date): string {
  const day = d.toLocaleDateString([], { weekday: "short" }).toLowerCase();
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${day} ${dd}  ${hh}:${mm}:${ss}`;
}

export function MenuBar() {
  const { webmcpReady, approval, activity, sound } = useStore(
    useShallow(selectMenuBar),
  );
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const latest = activity[0] ?? null;
  const ticker = latest
    ? `${new Date(latest.at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })}  ${latest.actor.toUpperCase()}  ${latest.computerId ?? ""}  ${latest.verb}${
        latest.detail ? ` ${latest.detail}` : ""
      }`
    : "";

  return (
    <header className="menubar">
      <span className="menubar-app">webmcp-computer</span>
      <button
        type="button"
        className="menubar-item"
        onClick={() => store.getState().setTimelineOpen(true)}
      >
        Action TimeLine
      </button>
      <button
        type="button"
        className="menubar-item"
        onClick={() => store.getState().replayBoot()}
      >
        Boot
      </button>
      {ticker ? <span className="menubar-ticker">{ticker}</span> : null}
      <span className="menubar-right">
        {approval ? <span className="menubar-warn">! approval</span> : null}
        <span className="menubar-extra">
          {webmcpReady ? "WebMCP  ready" : "WebMCP  missing"}
        </span>
        <button
          type="button"
          className="menubar-item snd"
          aria-label="toggle sound"
          title={sound ? "sound on" : "sound off"}
          onClick={() => store.getState().setSound(!sound)}
        >
          {sound ? "snd on" : "snd off"}
        </button>
        <span className="menubar-clock">{clockTime(now)}</span>
      </span>
    </header>
  );
}
