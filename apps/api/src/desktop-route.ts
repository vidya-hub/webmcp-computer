// Classify /desktops/:id/* paths so the API can send noVNC leftovers to :6901
// and the product stream to Selkies :6902. Origin + frame-ancestors live here
// so the classifier tests also document the trust boundary.

export const FRAME_ANCESTORS = "frame-ancestors 'self'";

export const DESKTOP_PERMISSIONS =
  "unload=*, tools=(self), clipboard-read=(self), clipboard-write=(self)";

export type DesktopClass =
  | "html-rfb"
  | "html-stream"
  | "novnc"
  | "package-stub"
  | "selkies";

export function originAllowed(
  origin: string | undefined | null,
  allowed: Set<string>,
): boolean {
  // Missing Origin = non-browser or same-origin navigation; allow (matches /api/ws).
  if (!origin) return true;
  return allowed.has(origin);
}

export function classifyDesktop(rest: string, hasStream: boolean): DesktopClass {
  const raw = rest.startsWith("/") ? rest : `/${rest}`;
  let path = raw;
  let search = "";
  const q = raw.indexOf("?");
  if (q >= 0) {
    path = raw.slice(0, q) || "/";
    search = raw.slice(q);
  }
  const v = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(
    "v",
  );

  if (path === "/package.json") return "package-stub";
  if (path === "/vnc.html" || v === "rfb") return "html-rfb";
  if (path === "/websockify" || path.startsWith("/core/")) return "novnc";
  if (path === "/" || path === "/index.html") {
    return hasStream ? "html-stream" : "html-rfb";
  }
  if (path.startsWith("/api/")) return "selkies";
  return hasStream ? "selkies" : "novnc";
}
