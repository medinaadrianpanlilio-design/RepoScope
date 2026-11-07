"use client";

import { ChevronDown, ChevronRight, ExternalLink, FileCode, Folder, Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fileConnections, githubFileUrl } from "@/lib/graph/details";
import { buildTree, extensionOf, extensionsOf, searchFiles, type TreeFolder } from "@/lib/graph/tree";
import type { GraphData, GraphFile } from "@/lib/graph/types";
import { foldersOf } from "@/lib/graph/view";
import { ConnectionList, SourceView, useFileSource } from "../file-views";

type Props = {
  repositoryId: string;
  analysisId: string;
  repositoryUrl: string;
  commitSha: string;
  initialFileId: number | null;
};

export function FileExplorer(props: Props) {
  const { analysisId } = props;
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/analysis/${analysisId}/graph`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message);
        setData(payload.data);
      })
      .catch((failure: Error) => {
        if (failure.name !== "AbortError") setError(failure.message || "We couldn't load the files.");
      });
    return () => controller.abort();
  }, [analysisId]);

  if (error) {
    return (
      <p role="alert" className="p-4 text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <p role="status" className="p-4 text-sm text-muted">
        Loading files…
      </p>
    );
  }
  return <Workspace {...props} data={data} />;
}

function Workspace({
  data,
  repositoryId,
  analysisId,
  repositoryUrl,
  commitSha,
  initialFileId,
}: Props & { data: GraphData }) {
  const [selected, setSelected] = useState<GraphFile | null>(
    () => data.files.find((file) => file.id === initialFileId) ?? null,
  );
  const [open, setOpen] = useState(() => new Set(selected ? foldersOf(selected.path) : []));
  const [query, setQuery] = useState("");
  const [extension, setExtension] = useState("");

  const extensions = useMemo(() => extensionsOf(data.files), [data.files]);
  const visibleFiles = useMemo(
    () => (extension ? data.files.filter((f) => extensionOf(f.path) === extension) : data.files),
    [data.files, extension],
  );
  const tree = useMemo(() => buildTree(visibleFiles), [visibleFiles]);
  const matches = useMemo(() => searchFiles(visibleFiles, query), [visibleFiles, query]);

  function openFile(file: GraphFile) {
    setSelected(file);
    setOpen((current) => new Set([...current, ...foldersOf(file.path)]));
    const url = new URL(window.location.href);
    url.searchParams.set("file", String(file.id));
    window.history.replaceState(window.history.state, "", url);
  }

  function toggleFolder(path: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }

  return (
    <div className="relative min-h-[560px] flex-1">
      <div className="flex flex-col lg:absolute lg:inset-0 lg:grid lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        <nav
          aria-label="Files"
          className="flex max-h-80 flex-col border-b border-line bg-sidebar lg:max-h-none lg:min-h-0 lg:border-r lg:border-b-0"
        >
          <div className="space-y-2 border-b border-line p-2">
            <label className="block">
              <span className="sr-only">Search file names</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${visibleFiles.length.toLocaleString("en-US")} files`}
                className="field"
              />
            </label>
            <label className="block">
              <span className="sr-only">Filter by extension</span>
              <select
                value={extension}
                onChange={(event) => setExtension(event.target.value)}
                className="field"
              >
                <option value="">All file types</option>
                {extensions.map((item) => (
                  <option key={item.extension} value={item.extension}>
                    {item.extension || "No extension"} ({item.count})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-1 text-xs">
            {query.trim() ? (
              matches.length === 0 ? (
                <p className="p-2 text-muted">No matching files.</p>
              ) : (
                <ul>
                  {matches.map((file) => (
                    <li key={file.id}>
                      <button
                        type="button"
                        onClick={() => openFile(file)}
                        aria-current={selected?.id === file.id ? "true" : undefined}
                        title={file.path}
                        className={rowClass(selected?.id === file.id)}
                      >
                        <span className="truncate font-mono">{file.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <TreeLevel
                folder={tree}
                depth={0}
                open={open}
                selectedId={selected?.id ?? null}
                onToggle={toggleFolder}
                onOpenFile={openFile}
              />
            )}
          </div>
        </nav>

        {selected ? (
          <FileView
            key={selected.id}
            data={data}
            file={selected}
            repositoryId={repositoryId}
            analysisId={analysisId}
            repositoryUrl={repositoryUrl}
            commitSha={commitSha}
            onOpenFile={openFile}
          />
        ) : (
          <div className="flex items-center justify-center p-8 text-sm text-muted lg:col-span-2">
            Choose a file to read its source and see how it connects.
          </div>
        )}
      </div>
    </div>
  );
}

function TreeLevel({
  folder,
  depth,
  open,
  selectedId,
  onToggle,
  onOpenFile,
}: {
  folder: TreeFolder;
  depth: number;
  open: Set<string>;
  selectedId: number | null;
  onToggle: (path: string) => void;
  onOpenFile: (file: GraphFile) => void;
}) {
  const indent = { paddingLeft: `${depth * 12 + 6}px` };

  return (
    <ul>
      {folder.folders.map((child) => {
        const isOpen = open.has(child.path);
        return (
          <li key={child.path}>
            <button
              type="button"
              onClick={() => onToggle(child.path)}
              aria-expanded={isOpen}
              style={indent}
              className={rowClass(false)}
            >
              {isOpen ? (
                <ChevronDown size={12} className="shrink-0 text-muted" aria-hidden />
              ) : (
                <ChevronRight size={12} className="shrink-0 text-muted" aria-hidden />
              )}
              <Folder size={13} className="shrink-0 text-accent" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono">{child.name}</span>
              <span className="shrink-0 pr-1 text-[10px] text-muted">{child.fileCount}</span>
            </button>
            {isOpen && (
              <TreeLevel
                folder={child}
                depth={depth + 1}
                open={open}
                selectedId={selectedId}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
              />
            )}
          </li>
        );
      })}
      {folder.files.map((file) => (
        <li key={file.id}>
          <button
            type="button"
            onClick={() => onOpenFile(file)}
            aria-current={selectedId === file.id ? "true" : undefined}
            title={file.path}
            style={indent}
            className={rowClass(selectedId === file.id)}
          >
            <span className="w-3 shrink-0" aria-hidden />
            <FileCode size={13} className="shrink-0 text-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono">
              {file.path.slice(file.path.lastIndexOf("/") + 1)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FileView({
  data,
  file,
  repositoryId,
  analysisId,
  repositoryUrl,
  commitSha,
  onOpenFile,
}: {
  data: GraphData;
  file: GraphFile;
  repositoryId: string;
  analysisId: string;
  repositoryUrl: string;
  commitSha: string;
  onOpenFile: (file: GraphFile) => void;
}) {
  const state = useFileSource(analysisId, file.id);
  const connections = useMemo(() => fileConnections(data, file.id), [data, file.id]);
  const exported = state.source?.exports ?? [];

  return (
    <>
      <section aria-label="Source" className="flex min-h-0 min-w-0 flex-col">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-3 py-2 text-xs">
          <h2 className="min-w-0 flex-1 basis-full truncate font-mono sm:basis-0" title={file.path}>
            {file.path}
          </h2>
          <span className="text-muted">
            {file.language} · {file.lines.toLocaleString("en-US")} lines
          </span>
          <Link
            href={`/repositories/${repositoryId}/architecture?file=${file.id}`}
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            <Share2 size={12} aria-hidden /> View in graph
          </Link>
          <a
            href={githubFileUrl(repositoryUrl, commitSha, file.path)}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            GitHub <ExternalLink size={12} aria-hidden />
          </a>
        </header>
        <div className="min-h-64 flex-1 overflow-auto">
          <SourceView {...state} />
        </div>
      </section>

      <aside
        aria-label="File connections"
        className="min-h-0 overflow-y-auto border-t border-line bg-sidebar lg:border-t-0 lg:border-l"
      >
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
        <section className="p-3 text-xs">
          <h3 className="font-medium">Exports {state.source && `(${exported.length})`}</h3>
          {state.source && exported.length === 0 && (
            <p className="mt-1 text-muted">This file has no exports.</p>
          )}
          <ul className="mt-1 space-y-0.5">
            {exported.map((name) => (
              <li key={name} className="truncate px-1 font-mono">
                {name}
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </>
  );
}

function rowClass(active: boolean): string {
  return `flex w-full items-center gap-1 rounded py-0.5 pr-1 text-left hover:bg-elevated ${
    active ? "bg-elevated text-accent" : ""
  }`;
}
