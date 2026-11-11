"use client";

import { useEffect, useRef } from "react";

/** The recording starts while the page loads; the part worth showing runs between these. */
const START = 4.4;
const END = 14.2;

/**
 * A real recording of the graph: three files picked in turn, each lighting up what it imports and
 * what imports it. Muted, looping only its real part, paused off screen and under reduced motion.
 */
export function GraphClip() {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const keepInRange = () => {
      if (element.currentTime < START || element.currentTime >= END) element.currentTime = START;
    };
    element.addEventListener("timeupdate", keepInRange);

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        keepInRange();
        void element.play().catch(() => {});
      } else {
        element.pause();
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      element.removeEventListener("timeupdate", keepInRange);
    };
  }, []);

  return (
    <video
      ref={video}
      className="graph-clip"
      src="/landing/graph-in-use.webm"
      poster="/landing/graph-in-use.webp"
      muted
      playsInline
      preload="metadata"
      aria-label="Recording of RepoScope's graph of pmndrs/zustand: picking vanilla.ts lights up the 17 files that import it"
    />
  );
}
