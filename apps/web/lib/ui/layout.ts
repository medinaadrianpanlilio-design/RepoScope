export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function readStoredWidth(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const width = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(width) ? clamp(width, min, max) : fallback;
}

/** A panel on the left grows as its edge moves right. A panel on the right grows moving left. */
export function resizedWidth(
  width: number,
  delta: number,
  side: "left" | "right",
  { min, max }: { min: number; max: number },
): number {
  return clamp(width + (side === "left" ? delta : -delta), min, max);
}

export function nextIndex(current: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return (current + delta + length) % length;
}

/** Single-key shortcuts must not fire while someone is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}
