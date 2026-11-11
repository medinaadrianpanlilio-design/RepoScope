"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const FRAMES = [
  { src: "/landing/hero-layered.webp", layout: "layered" },
  { src: "/landing/hero-force.webp", layout: "force-directed" },
  { src: "/landing/hero-folder.webp", layout: "by folder" },
];

const HOLD_MS = 5500;

/**
 * One real repository drawn three ways, crossfading like light shifting in a room. It holds still
 * under reduced motion and while the tab is hidden.
 */
export function HeroPicture() {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      if (!document.hidden) setShown((index) => (index + 1) % FRAMES.length);
    }, HOLD_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <figure className="hero-picture">
      <div className="hero-picture-stage">
        {FRAMES.map((frame, index) => (
          <Image
            key={frame.src}
            src={frame.src}
            alt={
              index === 0
                ? "RepoScope's dependency graph of pmndrs/zustand: each box is a file, each line an import"
                : ""
            }
            width={1400}
            height={1260}
            priority={index === 0}
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="hero-picture-frame"
            data-shown={index === shown}
          />
        ))}
      </div>
      <figcaption className="hero-picture-caption" aria-live="off">
        pmndrs/zustand, 52 files, drawn {FRAMES[shown]!.layout}
      </figcaption>
    </figure>
  );
}
