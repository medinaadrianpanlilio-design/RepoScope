"use client";

import { CircleHelp, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  cycleContaining,
  fileConnections,
  reach,
  unresolvedIn,
  type Connection,
} from "@/lib/graph/details";
import type { GraphFile, GraphPayload, RelationshipType } from "@/lib/graph/types";

const MAX_CYCLE_FILES_SHOWN = 12;

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

/** Everything about how one file connects. Used by the graph panel and the explorer. */
export function DependencyInspector({
  data,
  file,
  onOpenFile,
}: {
  data: GraphPayload;
  file: GraphFile;
  onOpenFile: (file: GraphFile) => void;
}) {
  const connections = useMemo(() => fileConnections(data, file.id), [data, file.id]);
  const dependsOn = useMemo(() => reach(data, file.id, "imports"), [data, file.id]);
  const usedBy = useMemo(() => reach(data, file.id, "importedBy"), [data, file.id]);
  const unresolved = useMemo(() => unresolvedIn(data.unresolved, file.id), [data.unresolved, file.id]);
  const cycle = cycleContaining(data.cycles, file.path);

  return (
    <>
      <section aria-label="Dependency reach" className="border-b border-line p-3 text-xs">
        <dl className="grid grid-cols-2 gap-3">
          <Reach
            label="Depends on"
            title="Every file this one reaches by following imports, directly or indirectly"
            direct={connections.imports.length}
            {...dependsOn}
          />
          <Reach
            label="Used by"
            title="Every file that reaches this one by following imports, directly or indirectly"
            direct={connections.importedBy.length}
            {...usedBy}
          />
        </dl>
      </section>

      {cycle && <CycleWarning cycle={cycle} file={file} files={data.files} onOpenFile={onOpenFile} />}

      {unresolved.length > 0 && (
        <section className="border-b border-line p-3 text-xs">
          <h3 className="flex items-center gap-1.5 font-medium">
            <CircleHelp size={14} className="text-muted" aria-hidden />
            Unresolved imports ({unresolved.length})
          </h3>
          <p className="mt-1 text-muted">
            These couldn&apos;t be matched to a file. They may be generated at build time, or RepoScope
            may not understand the setup.
          </p>
          <ul className="mt-2 space-y-0.5">
            {unresolved.map(({ specifier, line }) => (
              <li key={`${specifier}:${line}`} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate font-mono" title={specifier}>
                  {specifier}
                </span>
                <span className="shrink-0 text-muted">line {line}</span>
              </li>
            ))}
          </ul>
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
    </>
  );
}

function Reach({
  label,
  title,
  direct,
  count,
  depth,
}: {
  label: string;
  title: string;
  direct: number;
  count: number;
  depth: number;
}) {
  return (
    <div title={title}>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm">
        {count.toLocaleString("en-US")} {count === 1 ? "file" : "files"}
      </dd>
      <dd className="text-muted">
        {direct.toLocaleString("en-US")} direct · {depth} {depth === 1 ? "level" : "levels"} deep
      </dd>
    </div>
  );
}

function CycleWarning({
  cycle,
  file,
  files,
  onOpenFile,
}: {
  cycle: string[];
  file: GraphFile;
  files: GraphFile[];
  onOpenFile: (file: GraphFile) => void;
}) {
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const others = cycle.filter((path) => path !== file.path);

  return (
    <section className="border-b border-line p-3 text-xs">
      <h3 className="flex items-center gap-1.5 font-medium">
        <TriangleAlert size={14} className="text-accent-2" aria-hidden />
        Part of an import cycle
      </h3>
      <p className="mt-1 text-muted">
        {others.length === 0
          ? "This file imports itself."
          : `This file and ${others.length} others can reach each other through imports.`}{" "}
        That isn&apos;t necessarily a bug, but it can make code harder to change.
      </p>
      {others.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {others.slice(0, MAX_CYCLE_FILES_SHOWN).map((path) => {
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
          {others.length > MAX_CYCLE_FILES_SHOWN && (
            <li className="text-muted">and {others.length - MAX_CYCLE_FILES_SHOWN} more</li>
          )}
        </ul>
      )}
    </section>
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
