"use client";

import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File,
  FileCode,
  Folder,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Share2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ResizeHandle, useStoredWidth } from "@/components/resize-handle";
import { githubFileUrl } from "@/lib/graph/details";
import { buildTree, extensionOf, extensionsOf, searchFiles, type TreeFolder } from "@/lib/graph/tree";
import type { GraphFile, GraphPayload } from "@/lib/graph/types";
import { foldersOf } from "@/lib/graph/view";
import { clamp, isTypingTarget } from "@/lib/ui/layout";
import { DependencyInspector, SourceView, useFileSource } from "../file-views";

/** A file RepoScope didn't analyze, such as a stylesheet or image. It opens on GitHub. */
type OtherEntry = { id: null; path: string };
type Entry = GraphFile | OtherEntry;

const TREE_LIMITS = { min: 200, max: 520 };
const CONNECTIONS_LIMITS = { min: 220, max: 520 };

type Props = {
  repositoryId: string;
  analysisId: string;
  repositoryUrl: string;
  commitSha: string;
  initialFileId: number | null;
};

export function FileExplorer(props: Props) {
  const { analysisId } = props;
  const [data, setData] = useState<GraphPayload | null>(null);
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
}: Props & { data: GraphPayload }) {
  const [selected, setSelected] = useState<GraphFile | null>(
    () => data.files.find((file) => file.id === initialFileId) ?? null,
  );
  const [open, setOpen] = useState(() => new Set(selected ? foldersOf(selected.path) : []));
  const [query, setQuery] = useState("");
  const [extension, setExtension] = useState("");
  const [showTree, setShowTree] = useState(true);
  const [showConnections, setShowConnections] = useState(true);
  const [treeWidth, setTreeWidth] = useStoredWidth("reposcope:tree", 280, TREE_LIMITS);
  const [connectionsWidth, setConnectionsWidth] = useStoredWidth(
    "reposcope:connections",
    300,
    CONNECTIONS_LIMITS,
  );
  const searchInput = useRef<HTMLInputElement>(null);
  const rows = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        setShowTree(true);
        requestAnimationFrame(() => searchInput.current?.focus());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function focusRow(move: (current: number, last: number) => number) {
    const items = [...(rows.current?.querySelectorAll<HTMLElement>("a, button") ?? [])];
    const current = items.indexOf(document.activeElement as HTMLElement);
    items[clamp(move(current, items.length - 1), 0, items.length - 1)]?.focus();
  }

  function onRowsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const row = (event.target as HTMLElement).closest<HTMLElement>("a, button");
    const expanded = row?.getAttribute("aria-expanded");

    if (event.key === "ArrowDown") focusRow((current) => current + 1);
    else if (event.key === "ArrowUp") focusRow((current) => current - 1);
    else if (event.key === "Home") focusRow(() => 0);
    else if (event.key === "End") focusRow((_current, last) => last);
    else if (event.key === "ArrowRight" && expanded === "false") row?.click();
    else if (event.key === "ArrowLeft" && expanded === "true") row?.click();
    else return;
    event.preventDefault();
  }

  const entries = useMemo<Entry[]>(
    () => [...data.files, ...(data.otherFiles ?? []).map((path) => ({ id: null, path }))],
    [data.files, data.otherFiles],
  );
  const extensions = useMemo(() => extensionsOf(entries), [entries]);
  const visibleEntries = useMemo(
    () => (extension ? entries.filter((e) => extensionOf(e.path) === extension) : entries),
    [entries, extension],
  );
  const tree = useMemo(() => buildTree(visibleEntries), [visibleEntries]);
  const matches = useMemo(() => searchFiles(visibleEntries, query), [visibleEntries, query]);
  const selectedIsFiltered = selected && extension && extensionOf(selected.path) !== extension;
  const hiddenOtherFiles = data.otherFileCount - (data.otherFiles?.length ?? 0);

  function renderEntry(entry: Entry, label: string, indent?: { paddingLeft: string }): ReactNode {
    if (entry.id === null) {
      return (
        <a
          href={githubFileUrl(repositoryUrl, commitSha, entry.path)}
          target="_blank"
          rel="noreferrer noopener"
          title={`${entry.path}: not analyzed, opens on GitHub`}
          style={indent}
          className={`${rowClass(false)} text-muted`}
        >
          {indent && <span className="w-3 shrink-0" aria-hidden />}
          {indent && <File size={13} className="shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1 truncate font-mono">{label}</span>
          <ExternalLink size={10} className="shrink-0" aria-hidden />
        </a>
      );
    }

    const active = selected?.id === entry.id;
    return (
      <button
        type="button"
        onClick={() => openFile(entry)}
        aria-current={active ? "true" : undefined}
        title={entry.path}
        style={indent}
        className={rowClass(active)}
      >
        {indent && <span className="w-3 shrink-0" aria-hidden />}
        {indent && <FileCode size={13} className="shrink-0 text-muted" aria-hidden />}
        <span className="min-w-0 flex-1 truncate font-mono">{label}</span>
      </button>
    );
  }

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
      <div
        className="flex flex-col lg:absolute lg:inset-0 lg:grid"
        style={{
          gridTemplateColumns: [
            showTree && `${treeWidth}px`,
            "minmax(0, 1fr)",
            selected && showConnections && `${connectionsWidth}px`,
          ]
            .filter(Boolean)
            .join(" "),
        }}
      >
        <nav
          aria-label="Files"
          className={`relative flex max-h-80 flex-col border-b border-line bg-sidebar lg:max-h-none lg:min-h-0 lg:border-r lg:border-b-0 ${
            showTree ? "" : "lg:hidden"
          }`}
        >
          <ResizeHandle
            label="Resize file tree"
            side="left"
            width={treeWidth}
            onChange={setTreeWidth}
            className="hidden lg:block"
            {...TREE_LIMITS}
          />
          <div className="space-y-2 border-b border-line p-2">
            <label className="block">
              <span className="sr-only">Search file names</span>
              <input
                ref={searchInput}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusRow(() => 0);
                  } else if (event.key === "Escape") {
                    setQuery("");
                  }
                }}
                placeholder={`Search ${visibleEntries.length.toLocaleString("en-US")} files`}
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

          {selectedIsFiltered && (
            <p role="status" className="border-b border-line p-2 text-xs text-muted">
              The open file is hidden by this filter.{" "}
              <button
                type="button"
                onClick={() => setExtension("")}
                className="text-accent hover:underline"
              >
                Show all files
              </button>
            </p>
          )}

          <div
            ref={rows}
            onKeyDown={onRowsKeyDown}
            className="min-h-0 flex-1 overflow-auto p-1 text-xs"
          >
            {query.trim() ? (
              matches.length === 0 ? (
                <p className="p-2 text-muted">No matching files.</p>
              ) : (
                <ul>
                  {matches.map((entry) => (
                    <li key={entry.path}>{renderEntry(entry, entry.path)}</li>
                  ))}
                </ul>
              )
            ) : (
              <TreeLevel
                folder={tree}
                depth={0}
                open={open}
                onToggle={toggleFolder}
                renderEntry={renderEntry}
              />
            )}
          </div>

          {data.otherFiles === null && (
            <p className="border-t border-line p-2 text-xs text-muted">
              Only analyzed files are listed. Use Check for new commits on the overview to add the rest.
            </p>
          )}
          {hiddenOtherFiles > 0 && (
            <p className="border-t border-line p-2 text-xs text-muted">
              {hiddenOtherFiles.toLocaleString("en-US")} more non-code files aren&apos;t listed.
            </p>
          )}
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
            showTree={showTree}
            onToggleTree={() => setShowTree(!showTree)}
            showConnections={showConnections}
            onToggleConnections={() => setShowConnections(!showConnections)}
            connectionsWidth={connectionsWidth}
            onConnectionsWidthChange={setConnectionsWidth}
          />
        ) : (
          <div className="flex items-center justify-center p-8 text-sm text-muted">
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
  onToggle,
  renderEntry,
}: {
  folder: TreeFolder<Entry>;
  depth: number;
  open: Set<string>;
  onToggle: (path: string) => void;
  renderEntry: (entry: Entry, label: string, indent: { paddingLeft: string }) => ReactNode;
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
                onToggle={onToggle}
                renderEntry={renderEntry}
              />
            )}
          </li>
        );
      })}
      {folder.files.map((entry) => (
        <li key={entry.path}>
          {renderEntry(entry, entry.path.slice(entry.path.lastIndexOf("/") + 1), indent)}
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
  showTree,
  onToggleTree,
  showConnections,
  onToggleConnections,
  connectionsWidth,
  onConnectionsWidthChange,
}: {
  showTree: boolean;
  onToggleTree: () => void;
  showConnections: boolean;
  onToggleConnections: () => void;
  connectionsWidth: number;
  onConnectionsWidthChange: (width: number) => void;
  data: GraphPayload;
  file: GraphFile;
  repositoryId: string;
  analysisId: string;
  repositoryUrl: string;
  commitSha: string;
  onOpenFile: (file: GraphFile) => void;
}) {
  const state = useFileSource(analysisId, file.id);
  const exported = state.source?.exports ?? [];

  return (
    <>
      <section aria-label="Source" className="flex min-h-0 min-w-0 flex-col">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-3 py-2 text-xs">
          <PanelToggle
            label={showTree ? "Hide file tree" : "Show file tree"}
            onClick={onToggleTree}
            icon={showTree ? <PanelLeftClose size={14} aria-hidden /> : <PanelLeftOpen size={14} aria-hidden />}
          />
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
          <PanelToggle
            label={showConnections ? "Hide connections" : "Show connections"}
            onClick={onToggleConnections}
            icon={
              showConnections ? (
                <PanelRightClose size={14} aria-hidden />
              ) : (
                <PanelRightOpen size={14} aria-hidden />
              )
            }
          />
        </header>
        <div className="min-h-64 flex-1 overflow-auto">
          <SourceView {...state} />
        </div>
      </section>

      <aside
        aria-label="File connections"
        className={`relative min-h-0 border-t border-line bg-sidebar lg:border-t-0 lg:border-l ${
          showConnections ? "" : "lg:hidden"
        }`}
      >
        <ResizeHandle
          label="Resize connections"
          side="right"
          width={connectionsWidth}
          onChange={onConnectionsWidthChange}
          className="hidden lg:block"
          {...CONNECTIONS_LIMITS}
        />
        <div className="h-full overflow-y-auto">
        <DependencyInspector data={data} file={file} onOpenFile={onOpenFile} />
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
        </div>
      </aside>
    </>
  );
}

function PanelToggle({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="hidden p-0.5 text-muted hover:text-foreground lg:inline-flex"
    >
      {icon}
    </button>
  );
}

function rowClass(active: boolean): string {
  return `flex w-full items-center gap-1 rounded py-0.5 pr-1 text-left hover:bg-elevated ${
    active ? "bg-elevated text-accent" : ""
  }`;
}
