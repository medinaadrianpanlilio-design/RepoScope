"use client";

import { useEffect, useState } from "react";
import type { Connection } from "@/lib/graph/details";
import type { GraphFile, RelationshipType } from "@/lib/graph/types";

const TYPE_LABELS: Record<RelationshipType, string> = {
  static: "static",
  dynamic: "dynamic",
  reexport: "re-export",
  type: "type-only",
};

type Source = { html: string; exports: string[] };
export type SourceState = { source: Source | null; error: string | null };

/** Mount with a key per file, so a new file starts from the loading state. */
export function useFileSource(analysisId: string, fileId: number): SourceState {
  const [state, setState] = useState<SourceState>({ source: null, error: null });

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/analysis/${analysisId}/files/${fileId}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message);
        setState({ source: payload.data, error: null });
      })
      .catch((failure: Error) => {
        if (failure.name !== "AbortError") {
          setState({ source: null, error: failure.message || "We couldn't load this file." });
        }
      });

    return () => controller.abort();
  }, [analysisId, fileId]);

  return state;
}

export function SourceView({ source, error }: SourceState) {
  if (error) {
    return (
      <p role="alert" className="p-3 text-xs text-danger">
        {error}
      </p>
    );
  }
  if (!source) {
    return (
      <p role="status" className="p-3 text-xs text-muted">
        Loading source from GitHub…
      </p>
    );
  }
  // Shiki escapes the code on the server, so repository content can't become markup here.
  return <div className="source-view" dangerouslySetInnerHTML={{ __html: source.html }} />;
}

export function ConnectionList({
  title,
  empty,
  connections,
  color,
  onOpenFile,
}: {
  title: string;
  empty: string;
  connections: Connection[];
  color: string;
  onOpenFile: (file: GraphFile) => void;
}) {
  return (
    <section className="border-b border-line p-3 text-xs">
      <h3 className={`font-medium ${color}`}>
        {title} ({connections.length})
      </h3>
      {connections.length === 0 ? (
        <p className="mt-1 text-muted">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {connections.map(({ file, types }) => (
            <li key={file.id}>
              <button
                type="button"
                onClick={() => onOpenFile(file)}
                title={file.path}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-elevated"
              >
                <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                <span className="shrink-0 text-[10px] text-muted">
                  {types.map((type) => TYPE_LABELS[type]).join(", ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
