"use client";

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { readStoredWidth, resizedWidth } from "@/lib/ui/layout";

const KEYBOARD_STEP = 24;

type Limits = { min: number; max: number };

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // Storage can be blocked. The default width still works.
  }
}

function write(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Not saving a width is harmless.
  }
}

/** Only for components that render after mount, because it reads the browser's storage. */
export function useStoredWidth(key: string, fallback: number, { min, max }: Limits) {
  const [width, setWidth] = useState(() => readStoredWidth(read(key), fallback, min, max));

  const update = useCallback(
    (next: number) => {
      setWidth(next);
      write(key, next);
    },
    [key],
  );

  return [width, update] as const;
}

type Props = Limits & {
  label: string;
  width: number;
  side: "left" | "right";
  onChange: (width: number) => void;
  className?: string;
};

/** Drag it, or focus it and use the arrow keys. `side` is the side the panel sits on. */
export function ResizeHandle({ label, width, side, min, max, onChange, className = "" }: Props) {
  const drag = useRef<{ x: number; width: number } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const delta = event.clientX - drag.current.x;
    onChange(resizedWidth(drag.current.width, delta, side, { min, max }));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowLeft: -KEYBOARD_STEP, ArrowRight: KEYBOARD_STEP }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      onChange(resizedWidth(width, step, side, { min, max }));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      onChange(event.key === "Home" ? min : max);
    }
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={onKeyDown}
      className={`absolute inset-y-0 z-20 w-1.5 cursor-col-resize touch-none hover:bg-accent/40 focus-visible:bg-accent/60 ${
        side === "left" ? "-right-0.5" : "-left-0.5"
      } ${className}`}
    />
  );
}
