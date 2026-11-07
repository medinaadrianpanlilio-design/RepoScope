"use client";

import { Radar, X } from "lucide-react";
import { useMemo } from "react";
import type { ImpactedFile } from "@/lib/graph/impact";
import type { GraphFile } from "@/lib/graph/types";

const MAX_LISTED = 60;

type Props = {
  sources: GraphFile[];
  impacted: ImpactedFile[];
  onlyAffected: boolean;
  onOnlyAffectedChange: (value: boolean) => void;
  onRemove: (file: GraphFile) => void;
  onOpenFile: (file: GraphFile) => void;
  onClear: () => void;
};

export function ImpactPanel({
  sources,
  impacted,
  onlyAffected,
  onOnlyAffectedChange,
  onRemove,
  onOpenFile,
  onClear,
}: Props) {
  const depth = impacted.at(-1)?.depth ?? 0;
  const groups = useMemo(() => {
    const byDepth = new Map<number, GraphFile[]>();
    for (const item of impacted.slice(0, MAX_LISTED)) {
      byDepth.set(item.depth, [...(byDepth.get(item.depth) ?? []), item.file]);
    }
    return [...byDepth];
  }, [impacted]);

  return (
    <aside
      aria-label="Change impact"
      className="absolute top-16 left-3 z-10 flex max-h-[calc(100%-5rem)] w-[calc(100%-1.5rem)] flex-col rounded-md border border-line bg-card/95 text-xs sm:w-80"
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Radar size={14} className="text-impact" aria-hidden />
        <h2 className="flex-1 font-medium">Change impact</h2>
        <button type="button" onClick={onClear} aria-label="Clear change impact" className="text-muted hover:text-foreground">
          <X size={14} aria-hidden />
        </button>
      </header>

      <div className="min-h-0 overflow-y-auto p-3">
        <p>
          {impacted.length === 0
            ? "Nothing in this repository depends on the selected files."
            : `Changing ${sources.length === 1 ? "this file" : `these ${sources.length} files`} could affect ${impacted.length.toLocaleString("en-US")} ${impacted.length === 1 ? "file" : "files"}, up to ${depth} ${depth === 1 ? "level" : "levels"} away.`}
        </p>
        <p className="mt-1 text-muted">
          Based on imports. A listed file depends on this code, but won&apos;t necessarily break.
        </p>

        <ul className="mt-2 space-y-0.5">
          {sources.map((file) => (
            <li key={file.id} className="flex items-center gap-2 rounded bg-elevated px-1.5 py-0.5">
              <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>
                {file.path}
              </span>
              <button
                type="button"
                onClick={() => onRemove(file)}
                aria-label={`Remove ${file.path} from change impact`}
                className="shrink-0 text-muted hover:text-foreground"
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-muted">Add more files from the file panel.</p>

        {impacted.length > 0 && (
          <label className="mt-2 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={onlyAffected}
              onChange={(event) => onOnlyAffectedChange(event.target.checked)}
            />
            Show only affected files
          </label>
        )}

        {groups.map(([level, files]) => (
          <section key={level} className="mt-2">
            <h3 className="text-muted">{level === 1 ? "Direct" : `${level} levels away`}</h3>
            <ul>
              {files.map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => onOpenFile(file)}
                    title={file.path}
                    className="block w-full truncate rounded px-1 py-0.5 text-left font-mono hover:bg-elevated"
                  >
                    {file.path}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {impacted.length > MAX_LISTED && (
          <p className="mt-2 text-muted">
            and {(impacted.length - MAX_LISTED).toLocaleString("en-US")} more, shown on the graph.
          </p>
        )}
      </div>
    </aside>
  );
}
