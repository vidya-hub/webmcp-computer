const tiles = new Map<string, HTMLElement>();
let shelf: HTMLElement | null = null;

export function registerDockTile(id: string, el: HTMLElement | null): void {
  if (el) tiles.set(id, el);
  else tiles.delete(id);
}

export function registerDockShelf(el: HTMLElement | null): void {
  shelf = el;
}

export function getDockTileRect(id: string): DOMRect | null {
  const el = tiles.get(id);
  if (el) return el.getBoundingClientRect();
  return shelf?.getBoundingClientRect() ?? null;
}
