"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

const LAYOUTS = [
  {
    name: "Layered",
    src: "/landing/layout-layered.webp",
    text: "Files line up in the order they depend on each other, so you can read the code from its entry points to the files everything else rests on.",
  },
  {
    name: "Force-directed",
    src: "/landing/layout-force.webp",
    text: "Files that import each other pull together. The busiest parts of the code gather in the middle, and loners drift to the edge.",
  },
  {
    name: "By folder",
    src: "/landing/layout-folder.webp",
    text: "Every folder becomes a frame around its files, so you see where the code lives and which imports cross from one folder to another.",
  },
];

export function LayoutShowcase({ kyHref }: { kyHref: string | null }) {
  const [active, setActive] = useState(0);
  const layout = LAYOUTS[active]!;

  return (
    <section aria-labelledby="layouts-heading" className="showcase reveal">
      <div className="showcase-plate">
        {LAYOUTS.map((item, index) => (
          <Image
            key={item.src}
            src={item.src}
            alt={index === active ? `sindresorhus/ky drawn with the ${item.name.toLowerCase()} layout` : ""}
            width={1200}
            height={1200}
            sizes="(min-width: 1024px) 45vw, 100vw"
            className="showcase-image"
            data-shown={index === active}
          />
        ))}
      </div>

      <div className="showcase-text">
        <div role="tablist" aria-label="Graph layouts" className="showcase-tabs">
          {LAYOUTS.map((item, index) => (
            <button
              key={item.name}
              type="button"
              role="tab"
              id={`layout-tab-${index}`}
              aria-selected={index === active}
              aria-controls="layout-panel"
              tabIndex={index === active ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                const next = (active + (event.key === "ArrowRight" ? 1 : LAYOUTS.length - 1)) % LAYOUTS.length;
                setActive(next);
                document.getElementById(`layout-tab-${next}`)?.focus();
              }}
              className="showcase-tab"
            >
              {item.name}
            </button>
          ))}
        </div>

        <div id="layout-panel" role="tabpanel" aria-labelledby={`layout-tab-${active}`}>
          <h2 id="layouts-heading" className="type-l">
            Three ways to read it
          </h2>
          <p className="showcase-description">{layout.text}</p>
          <p className="showcase-note">Shown: sindresorhus/ky, 98 files and 184 imports between them.</p>
        </div>

        <div className="showcase-actions">
          <a href="#analyze" className="cell cell-ink">
            Analyze yours
          </a>
          {kyHref && (
            <Link href={kyHref} className="cell cell-tone">
              Open this map
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
