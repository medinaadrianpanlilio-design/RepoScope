"use client";

import { useState } from "react";
import { LANGUAGE_COLORS } from "./file-node";

type Form = { code: string; kind: string; note: string };

const SHARED: Form[] = [
  { code: 'import { create } from "./vanilla"', kind: "Static import", note: "The everyday import. Default, named and namespace imports all count." },
  { code: 'const ms = require("./ms")', kind: "Static import", note: "CommonJS reads the same way, as long as the path is written out." },
  { code: 'const page = await import("./page")', kind: "Dynamic import", note: "Loaded later, drawn dashed. A path built at run time is listed, never guessed." },
  { code: 'export * from "./middleware"', kind: "Re-export", note: "A file that passes another file's exports along, drawn thicker." },
];

const TYPED: Form = {
  code: 'import type { StoreApi } from "./vanilla"',
  kind: "Type-only import",
  note: "Needed by the type checker, gone at run time, drawn dotted.",
};

const LANGUAGES = [
  { name: "TypeScript", extensions: ".ts .mts .cts", forms: [...SHARED, TYPED] },
  { name: "TSX", extensions: ".tsx", forms: [...SHARED, TYPED] },
  { name: "JavaScript", extensions: ".js .mjs .cjs", forms: SHARED },
  { name: "JSX", extensions: ".jsx", forms: SHARED },
];

export function Languages() {
  const [active, setActive] = useState(0);
  const language = LANGUAGES[active]!;

  return (
    <div className="languages">
      <div role="tablist" aria-label="Languages" aria-orientation="vertical" className="language-tabs">
        {LANGUAGES.map((item, index) => (
          <button
            key={item.name}
            type="button"
            role="tab"
            id={`language-tab-${index}`}
            aria-selected={index === active}
            aria-controls="language-panel"
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={(event) => {
              const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
              if (!step) return;
              event.preventDefault();
              const next = (active + step + LANGUAGES.length) % LANGUAGES.length;
              setActive(next);
              document.getElementById(`language-tab-${next}`)?.focus();
            }}
            className="language-tab"
          >
            <span className="language-tab-name">
              <span className="language-dot" style={{ background: LANGUAGE_COLORS[item.name] }} aria-hidden />
              {item.name}
            </span>
            <span className="language-tab-extensions">{item.extensions}</span>
          </button>
        ))}
      </div>

      <div id="language-panel" role="tabpanel" aria-labelledby={`language-tab-${active}`}>
        <ul className="language-forms">
          {language.forms.map((form) => (
            <li key={form.code} className="language-form">
              <code className="language-code">{form.code}</code>
              <span className="language-kind">
                <span className="language-kind-name">{form.kind}</span>
                <span className="language-kind-note">{form.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
