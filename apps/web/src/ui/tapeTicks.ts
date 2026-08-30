const NICE_MS = [
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000,
  600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000, 28_800_000,
  86_400_000,
];

/** ~12 labels across any span so a multi-day tape cannot mount thousands of ticks. */
export function tickMarks(tMin: number, tMax: number, maxTicks = 12): {
  ticks: number[];
  step: number;
} {
  const span = Math.max(1000, tMax - tMin);
  const raw = span / maxTicks;
  const step = NICE_MS.find((n) => n >= raw) ?? NICE_MS[NICE_MS.length - 1]!;
  const start = Math.floor(tMin / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= tMax && ticks.length < maxTicks + 2; t += step) {
    ticks.push(t);
  }
  return { ticks, step };
}

export function shortComputerId(id: string): string {
  const parts = id.split(/[-_]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
  return id.length > 14 ? `${id.slice(0, 12)}…` : id;
}
