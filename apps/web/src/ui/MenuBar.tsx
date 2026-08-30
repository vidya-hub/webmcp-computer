import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { logout } from "../auth/session.ts";
import { store, useStore } from "../store/index.ts";
import { selectMenuBar } from "../store/selectors.ts";

function clockTime(d: Date): string {
  const day = d.toLocaleDateString([], { weekday: "short" }).toLowerCase();
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${dd}  ${hh}:${mm}`;
}

export function MenuBar() {
  const {
    webmcpReady,
    approval,
    activity,
    sound,
    apiOnline,
    recordingComputerId,
    toastsVisible,
  } = useStore(useShallow(selectMenuBar));
  const session = useStore((s) => s.session);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let t = 0;
    const schedule = () => {
      const d = new Date();
      setNow(d);
      const ms = 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 20;
      t = window.setTimeout(schedule, ms);
    };
    schedule();
    return () => window.clearTimeout(t);
  }, []);

  const latest = activity[0] ?? null;
  const ticker =
    !toastsVisible && latest
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
      <span className="menubar-app">WebMCP Computer</span>
      <button
        type="button"
        className="menubar-item"
        onClick={() => store.getState().openInspector("tape", { filter: "all" })}
      >
        Timeline
      </button>
      <button
        type="button"
        className="menubar-item"
        onClick={() => store.getState().openInspector("recipes")}
      >
        Recipes
      </button>
      {ticker ? (
        <span className="menubar-ticker" title={ticker}>
          {ticker}
        </span>
      ) : null}
      <span className="menubar-right">
        {recordingComputerId ? (
          <span className="menubar-rec" title={`Recording ${recordingComputerId}`}>
            ● REC
          </span>
        ) : null}
        {apiOnline ? null : (
          <span className="menubar-warn" title="Control plane unreachable — reconnecting">
            Offline
          </span>
        )}
        {approval ? <span className="menubar-warn">! approval</span> : null}
        <span className="menubar-extra">
          {webmcpReady ? "WebMCP ready" : "WebMCP missing"}
        </span>
        <button
          type="button"
          className="menubar-item snd"
          aria-label="toggle sound"
          title={sound ? "sound on" : "sound off"}
          onClick={() => store.getState().setSound(!sound)}
        >
          {sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>
        {session ? (
          <button
            type="button"
            className="menubar-item"
            title={`Sign out ${session.email}`}
            onClick={() => void logout()}
          >
            Sign out
          </button>
        ) : null}
        <span className="menubar-clock">{clockTime(now)}</span>
      </span>
    </header>
  );
}
