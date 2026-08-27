const ADJECTIVES = [
  "quiet",
  "brisk",
  "amber",
  "copper",
  "hollow",
  "rapid",
  "still",
  "vivid",
  "calm",
  "keen",
  "lone",
  "pale",
] as const;

const NOUNS = [
  "ridge",
  "harbor",
  "grove",
  "relay",
  "spool",
  "hearth",
  "quay",
  "field",
  "loom",
  "well",
  "drift",
  "notch",
] as const;

export const WALLPAPER_CYCLE = [
  "carbon",
  "dark-grid",
  "void",
  "arrows",
] as const;

export const MAX_COMPUTERS = 4;

export function slugifyName(raw: string): string | null {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : null;
}

export function generateComputerId(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)] ?? "quiet";
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)] ?? "ridge";
  const hex = Math.floor(Math.random() * 0xfff)
    .toString(16)
    .padStart(3, "0");
  return `${adj}-${noun}-${hex}`;
}

export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function allocateName(
  name: string | undefined,
  taken: Iterable<string>,
): { id: string; name: string } {
  if (name !== undefined) {
    const slug = slugifyName(name);
    if (!slug) {
      throw new Error("invalid name");
    }
    const id = uniqueId(slug, taken);
    return { id, name: name.trim() };
  }
  const id = uniqueId(generateComputerId(), taken);
  return { id, name: id };
}
