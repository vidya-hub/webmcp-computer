import { useEffect, useRef, useState } from "react";
import App from "../App.tsx";
import { resolveAuthPhase, screenFor, type Phase } from "../auth/gate.ts";
import { applySession, fetchConfig, fetchMe, login } from "../auth/session.ts";
import { useStore } from "../store/index.ts";
import { ErrorBoundary } from "./ErrorBoundary.tsx";

// The single gate: nothing that talks to /api, opens /api/ws, registers WebMCP
// tools, or mounts a desktop iframe renders until there is a session.
export function AuthGate() {
  const session = useStore((s) => s.session);
  const [phase, setPhase] = useState<Phase>("loading");

  // Re-run boot whenever there is no session — initial mount AND after logout /
  // a mid-session 401 clears it. Without the session dependency the phase would
  // stay "loading" forever after logout and stick on BootScreen.
  useEffect(() => {
    if (session) return; // logged in: <App/> renders, no boot needed
    let cancelled = false;
    setPhase("loading");
    void resolveAuthPhase({ fetchMe, fetchConfig, applySession }).then((p) => {
      if (!cancelled) setPhase(p);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  switch (screenFor(session, phase)) {
    case "app":
      return (
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      );
    case "closed":
      return <ClosedScreen />;
    case "login":
      return <LoginScreen />;
    default:
      return <BootScreen />;
  }
}

function BootScreen() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="sheet-mark">webmcp-computer</div>
        <p className="sheet-body">Checking your session…</p>
      </div>
    </div>
  );
}

function ClosedScreen() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="sheet-mark">webmcp-computer</div>
        <h2>Access is closed</h2>
        <p className="sheet-body">
          This instance is not accepting logins right now. Contact the
          administrator if you need access.
        </p>
      </div>
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  async function submit() {
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      // applySession sets store.session → AuthGate re-renders into the app.
    } catch (err) {
      setError(err instanceof Error ? err.message : "invalid email or password");
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form
        className="auth-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="sheet-mark">webmcp-computer</div>
        <h2>Sign in</h2>
        <input
          ref={emailRef}
          type="email"
          className="rec-input"
          placeholder="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          className="rec-input"
          placeholder="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="auth-error">{error}</p> : null}
        <div className="sheet-actions">
          <button
            type="submit"
            className="btn-approve"
            disabled={busy || !email.trim() || !password}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
