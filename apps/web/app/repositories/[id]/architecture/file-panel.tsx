"use client";

import { ExternalLink, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cycleContaining, fileConnections, githubFileUrl, type Connection } from "@/lib/graph/details";
import type { GraphData, GraphFile, RelationshipType } from "@/lib/graph/types";

const TYPE_LABELS: Record<RelationshipType, string> = {
  static: "static",
  dynamic: "dynamic",
  reexport: "re-export",
  type: "type-only",
};

const MAX_CYCLE_FILES_SHOWN = 12;

type Props = {
  analysisId: string;
  data: GraphData;
  cycles: string[][];
  file: GraphFile;
  repositoryUrl: string;
  commitSha: string;
  hideUnrelated: boolean;
  onHideUnrelatedChange: (hide: boolean) => void;
  onOpenFile: (file: GraphFile) => void;
  onClose: () => void;
};

export function FilePanel({
  analysisId,
  data,
  cycles,
  file,
  repositoryUrl,
  commitSha,
  hideUnrelated,
  onHideUnrelatedChange,
  onOpenFile,
  onClose,
}: Props) {
  const connections = useMemo(() => fileConnections(data, file.id), [data, file.id]);
  const cycle = cycleContaining(cycles, file.path);
  const byPath = useMemo(() => new Map(data.files.map((f) => [f.path, f])), [data.files]);

  return (
    <aside
      aria-label={`Details for ${file.path}`}
      className="absolute inset-x-0 bottom-0 z-10 flex h-[55%] flex-col border-t border-line bg-sidebar sm:inset-y-0 sm:right-0 sm:left-auto sm:h-auto sm:w-[420px] sm:border-t-0 sm:border-l"
    >
      <header className="flex items-start gap-2 border-b border-line p-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-sm font-semibold">{nameOf(file.path)}</h2>
          <p className="truncate font-mono text-xs text-muted" title={file.path}>
            {file.path}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close file details" className="p-1 text-muted hover:text-foreground">
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <dl className="grid grid-cols-3 gap-px border-b border-line bg-line text-xs">
          <Fact label="Language" value={file.language} />
          <Fact label="Lines" value={file.lines.toLocaleString("en-US")} />
          <Fact label="Connections" value={String(connections.imports.length + connections.importedBy.length)} />
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={hideUnrelated}
              onChange={(event) => onHideUnrelatedChange(event.target.checked)}
            />
            Hide unrelated
          </label>
          <a
            href={githubFileUrl(repositoryUrl, commitSha, file.path)}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            View on GitHub <ExternalLink size={12} aria-hidden />
          </a>
        </div>

        {cycle && (
          <section className="border-b border-line p-3 text-xs">
            <h3 className="flex items-center gap-1.5 font-medium">
              <TriangleAlert size={14} className="text-accent-2" aria-hidden />
              Part of an import cycle
            </h3>
            <p className="mt-1 text-muted">
              {cycle.length === 1
                ? "This file imports itself."
                : `This file and ${cycle.length - 1} others can reach each other through imports.`}{" "}
              That isn&apos;t necessarily a bug, but it can make code harder to change.
            </p>
            {cycle.length > 1 && (
              <ul className="mt-2 space-y-0.5">
                {cycle
                  .filter((path) => path !== file.path)
                  .slice(0, MAX_CYCLE_FILES_SHOWN)
                  .map((path) => {
                    const target = byPath.get(path);
                    return (
                      <li key={path}>
                        {target ? (
                          <button
                            type="button"
                            onClick={() => onOpenFile(target)}
                            className="block w-full truncate text-left font-mono hover:text-accent"
                          >
                            {path}
                          </button>
                        ) : (
                          <span className="font-mono text-muted">{path}</span>
                        )}
                      </li>
                    );
                  })}
                {cycle.length - 1 > MAX_CYCLE_FILES_SHOWN && (
                  <li className="text-muted">
                    and {cycle.length - 1 - MAX_CYCLE_FILES_SHOWN} more
                  </li>
                )}
              </ul>
            )}
          </section>
        )}

        <ConnectionList
          title="Imports"
          empty="This file doesn't import other files in the repository."
          connections={connections.imports}
          color="text-accent"
          onOpenFile={onOpenFile}
        />
        <ConnectionList
          title="Imported by"
          empty="No other file in the repository imports this one."
          connections={connections.importedBy}
          color="text-accent-2"
          onOpenFile={onOpenFile}
        />

        <section>
          <h3 className="border-b border-line px-3 py-2 text-xs font-medium">Source</h3>
          <SourcePreview key={file.id} analysisId={analysisId} fileId={file.id} />
        </section>
      </div>
    </aside>
  );
}

function ConnectionList({
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

function SourcePreview({ analysisId, fileId }: { analysisId: string; fileId: number }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/analysis/${analysisId}/files/${fileId}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message);
        setHtml(payload.data.html);
      })
      .catch((failure: Error) => {
        if (failure.name !== "AbortError") {
          setError(failure.message || "We couldn't load this file.");
        }
      });

    return () => controller.abort();
  }, [analysisId, fileId]);

  if (error) {
    return (
      <p role="alert" className="p-3 text-xs text-danger">
        {error}
      </p>
    );
  }
  if (html === null) {
    return (
      <p role="status" className="p-3 text-xs text-muted">
        Loading source from GitHub…
      </p>
    );
  }
  // Shiki escapes the code on the server, so repository content can't become markup here.
  return <div className="source-view" dangerouslySetInnerHTML={{ __html: html }} />;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-sidebar p-3">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-mono">{value}</dd>
    </div>
  );
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
