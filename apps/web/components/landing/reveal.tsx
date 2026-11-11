"use client";

import { useEffect } from "react";

/**
 * Lets each section's parts rise in as it arrives. Content is visible without this script: the
 * hidden starting state only applies once it has marked the page, and never under reduced motion.
 */
export function Reveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    const sections = [...document.querySelectorAll<HTMLElement>(".reveal")];
    const below = sections.filter((section) => section.getBoundingClientRect().top > window.innerHeight * 0.85);
    for (const section of below) section.dataset.revealed = "false";
    root.classList.add("reveal-ready");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealed = "true";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const section of below) observer.observe(section);
    return () => {
      observer.disconnect();
      root.classList.remove("reveal-ready");
    };
  }, []);

  return null;
}
