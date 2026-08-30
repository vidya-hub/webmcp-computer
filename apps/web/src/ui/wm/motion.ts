export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type RectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const DUR_MS = 380;

function invert(from: RectLike, to: RectLike): string {
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = from.width / Math.max(1, to.width);
  const sy = from.height / Math.max(1, to.height);
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

function once(el: HTMLElement, onDone: () => void): void {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.removeEventListener("transitionend", onEnd);
    window.clearTimeout(timer);
    onDone();
  };
  const onEnd = (e: TransitionEvent) => {
    if (e.target !== el) return;
    if (e.propertyName !== "transform" && e.propertyName !== "opacity") return;
    finish();
  };
  el.addEventListener("transitionend", onEnd);
  const timer = window.setTimeout(finish, DUR_MS + 80);
}

/** First = `from`, last = element's current box. Invert then play to identity. */
export function flipFrom(
  el: HTMLElement,
  from: RectLike | null,
  onDone: () => void,
): void {
  if (!from || prefersReducedMotion()) {
    el.style.transform = "";
    el.style.opacity = "";
    el.style.transition = "";
    onDone();
    return;
  }
  const to = el.getBoundingClientRect();
  el.style.transformOrigin = "top left";
  el.style.transition = "none";
  el.style.transform = invert(from, to);
  el.style.opacity = "0.45";
  once(el, () => {
    el.style.transition = "";
    el.style.transform = "";
    el.style.opacity = "";
    onDone();
  });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transition = `transform ${DUR_MS}ms var(--ease-out-expo), opacity ${DUR_MS}ms var(--ease-out-expo)`;
      el.style.transform = "none";
      el.style.opacity = "1";
    });
  });
}

/** Fly the live element toward `to`, then call onDone (typically unmount). */
export function flyTo(
  el: HTMLElement,
  to: RectLike | null,
  onDone: () => void,
): void {
  if (!to || prefersReducedMotion()) {
    onDone();
    return;
  }
  const from = el.getBoundingClientRect();
  el.style.transformOrigin = "top left";
  el.style.transition = `transform ${DUR_MS}ms var(--ease-out-expo), opacity ${DUR_MS}ms var(--ease-out-expo)`;
  el.style.transform = invert(to, from);
  el.style.opacity = "0.35";
  once(el, onDone);
}
