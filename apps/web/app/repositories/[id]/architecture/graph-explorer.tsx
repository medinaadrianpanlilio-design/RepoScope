"use client";

import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RELATIONSHIP_TYPES,
  type GraphData,
  type RelationshipType,
  type ViewNode,
} from "@/lib/graph/types";
import { connectedTo, defaultExpanded, foldersOf, toGraphView } from "@/lib/graph/view";
import { FilePanel } from "./file-panel";
import { nodeTypes, NODE_HEIGHT, NODE_WIDTH } from "./graph-nodes";

type Positions = Record<string, { x: number; y: number }>;

const EDGE_STYLES: Record<RelationshipType, { label: string; dash?: string; width: number }> = {
  static: { label: "Static import", width: 1.25 },
  dynamic: { label: "Dynamic import", dash: "8 5", width: 1.25 },
  reexport: { label: "Re-export", width: 2.25 },
  type: { label: "Type-only import", dash: "2 4", width: 1 },
};

const MAX_SEARCH_RESULTS = 8;

type Source = {
  repositoryId: string;
  analysisId: string;
  repositoryUrl: string;
  commitSha: string;
  initialFileId: number | null;
};
type GraphPayload = GraphData & { cycles: string[][] };

export function GraphExplorer(source: Source) {
  return (
    <ReactFlowProvider>
      <Explorer {...source} />
    </ReactFlowProvider>
  );
}

function Explorer(source: Source) {
  const { analysisId } = source;
  const [data, setData] = useState<GraphPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/analysis/${analysisId}/graph`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message);
        if (!cancelled) setData(payload.data);
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message || "We couldn't load this graph.");
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  if (loadError) return <Notice title="We couldn't load this graph" body={loadError} />;
  if (!data) return <Notice title="Loading the graph…" body="Reading the saved analysis." />;
  if (data.files.length === 0) {
    return <Notice title="Nothing to show" body="This analysis found no source files." />;
  }
  return <Canvas key={analysisId} data={data} source={source} />;
}

function Canvas({ data, source }: { data: GraphPayload; source: Source }) {
  const flow = useReactFlow();
  const initialFile = data.files.find((file) => file.id === source.initialFileId);
  const [expanded, setExpanded] = useState(
    () =>
      new Set([
        ...defaultExpanded(data.files),
        ...(initialFile ? foldersOf(initialFile.path) : []),
      ]),
  );
  const [positions, setPositions] = useState<Positions | null>(null);
  const [layoutFailed, setLayoutFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(
    initialFile ? `file:${initialFile.id}` : null,
  );
  const [hideUnrelated, setHideUnrelated] = useState(false);
  const [hiddenTypes, setHiddenTypes] = useState<Set<RelationshipType>>(new Set());
  const [hiddenLanguages, setHiddenLanguages] = useState<Set<string>>(new Set());
  const [directory, setDirectory] = useState("");
  const [query, setQuery] = useState("");
  const [layoutRun, setLayoutRun] = useState(0);
  const [legendOpen, setLegendOpen] = useState(() => window.innerWidth >= 640);
  const [dragged, setDragged] = useState<Positions>({});
  const pendingFocus = useRef<string | null>(initialFile ? `file:${initialFile.id}` : null);
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);

  const view = useMemo(() => toGraphView(data, expanded), [data, expanded]);

  const languages = useMemo(
    () => [...new Set(data.files.map((file) => file.language))].sort(),
    [data.files],
  );
  const topFolders = useMemo(
    () => [...new Set(data.files.flatMap((file) => foldersOf(file.path).slice(0, 1)))].sort(),
    [data.files],
  );

  useEffect(() => {
    worker.current = new Worker(new URL("../../../../lib/graph/layout.worker.ts", import.meta.url));
    return () => worker.current?.terminate();
  }, []);

  useEffect(() => {
    const current = worker.current;
    if (!current) return;
    const id = ++requestId.current;

    current.onmessage = ({ data: message }) => {
      if (message.requestId !== requestId.current) return;
      if (message.error) setLayoutFailed(true);
      else {
        setLayoutFailed(false);
        setDragged({});
        setPositions(message.positions);
      }
    };
    current.postMessage({
      requestId: id,
      nodes: view.nodes.map(({ id: nodeId }) => ({
        id: nodeId,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      })),
      edges: view.edges.filter((edge) => edge.source !== edge.target),
    });
  }, [view, layoutRun]);

  const fitTo = useCallback(
    (nodeId: string | null) => {
      requestAnimationFrame(() =>
        flow.fitView({
          duration: 300,
          padding: nodeId ? 2 : 0.1,
          maxZoom: 1.2,
          ...(nodeId ? { nodes: [{ id: nodeId }] } : {}),
        }),
      );
    },
    [flow],
  );

  useEffect(() => {
    if (!positions) return;
    fitTo(pendingFocus.current);
    pendingFocus.current = null;
  }, [positions, fitTo]);

  useEffect(() => {
    if (positions) fitTo(null);
    // Only a change of what's shown should move the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideUnrelated, directory]);

  useEffect(() => {
    const onResize = () => fitTo(null);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitTo]);

  const related = useMemo(
    () => (selected ? connectedTo(selected, view.edges) : null),
    [selected, view.edges],
  );

  const nodes = useMemo<Node[]>(() => {
    if (!positions) return [];

    const isVisible = (node: ViewNode) => {
      if (directory && node.path !== directory && !node.path.startsWith(`${directory}/`)) return false;
      if (node.kind === "file" && hiddenLanguages.has(node.file.language)) return false;
      if (hideUnrelated && related && node.id !== selected) {
        return related.incoming.has(node.id) || related.outgoing.has(node.id);
      }
      return true;
    };

    return view.nodes.flatMap((node) => {
      const position = dragged[node.id] ?? positions[node.id];
      if (!position) return [];
      const state = !related
        ? ""
        : node.id === selected
          ? "is-selected"
          : related.incoming.has(node.id)
            ? "is-incoming"
            : related.outgoing.has(node.id)
              ? "is-outgoing"
              : "is-dimmed";
      return [
        {
          id: node.id,
          type: node.kind,
          position,
          data: node,
          className: state,
          hidden: !isVisible(node),
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        },
      ];
    });
  }, [view.nodes, positions, dragged, related, selected, directory, hiddenLanguages, hideUnrelated]);

  const edges = useMemo<Edge[]>(() => {
    const shown = new Set(nodes.filter((node) => !node.hidden).map((node) => node.id));
    return view.edges.map((edge) => {
      const style = EDGE_STYLES[edge.type];
      const touches = selected !== null && (edge.source === selected || edge.target === selected);
      const color = !selected
        ? "#4b5563"
        : !touches
          ? "#262c38"
          : edge.source === selected
            ? "#5b9cff"
            : "#8b7cff";
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        hidden: hiddenTypes.has(edge.type) || !shown.has(edge.source) || !shown.has(edge.target),
        label: edge.count > 1 ? String(edge.count) : undefined,
        labelStyle: { fill: "#9ca3af", fontSize: 10 },
        labelBgStyle: { fill: "#0b0d12" },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        style: { stroke: color, strokeWidth: style.width, strokeDasharray: style.dash },
      };
    });
  }, [view.edges, nodes, hiddenTypes, selected]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return data.files
      .filter((file) => file.path.toLowerCase().includes(needle))
      .slice(0, MAX_SEARCH_RESULTS);
  }, [data.files, query]);

  function revealFile(file: GraphData["files"][number]) {
    const id = `file:${file.id}`;
    setQuery("");
    setDirectory("");
    setSelected(id);

    const closed = foldersOf(file.path).filter((folder) => !expanded.has(folder));
    if (closed.length > 0) {
      pendingFocus.current = id;
      setExpanded(new Set([...expanded, ...closed]));
    } else {
      fitTo(id);
    }
  }

  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (!next.delete(value)) next.add(value);
    return next;
  }

  function onNodeClick(_event: unknown, node: Node) {
    if (node.type === "folder") {
      const { path } = node.data as { path: string };
      setSelected(null);
      setExpanded(new Set([...expanded, path]));
    } else {
      setSelected(node.id === selected ? null : node.id);
    }
  }

  function closeAll() {
    setSelected(null);
    setExpanded(defaultExpanded(data.files));
  }

  const hasFolders = topFolders.length > 0;
  const selectedFile = selected
    ? data.files.find((file) => `file:${file.id}` === selected)
    : undefined;

  return (
    <div className="relative min-h-[520px] flex-1">
      <div className="absolute inset-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={() => setSelected(null)}
        onNodeDragStop={(_event, node) =>
          setDragged((current) => ({ ...current, [node.id]: node.position }))
        }
        onlyRenderVisibleElements
        nodesConnectable={false}
        minZoom={0.05}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        aria-label="Dependency graph"
      >
        <Background gap={24} color="#1c2230" bgColor="#0b0d12" />
        <Controls
          showInteractive={false}
          position="bottom-right"
          className={selected ? "sm:!mr-[432px]" : undefined}
        />
      </ReactFlow>
      </div>

      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start gap-2">
        <div className="pointer-events-auto relative w-full sm:w-72">
          <Search size={14} className="absolute top-2.5 left-2.5 text-muted" aria-hidden />
          <label>
            <span className="sr-only">Search files</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && matches[0]) revealFile(matches[0]);
                if (event.key === "Escape") setQuery("");
              }}
              placeholder={`Search ${data.files.length.toLocaleString("en-US")} files`}
              className="field pl-8"
            />
          </label>
          {query.trim() && (
            <ul className="mt-1 max-h-72 overflow-auto rounded-md border border-line bg-card text-sm shadow-lg">
              {matches.length === 0 && <li className="px-3 py-2 text-muted">No matching files</li>}
              {matches.map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => revealFile(file)}
                    className="block w-full truncate px-3 py-1.5 text-left font-mono text-xs hover:bg-elevated"
                  >
                    {file.path}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="pointer-events-auto flex flex-wrap gap-2">
          {hasFolders && (
            <label>
              <span className="sr-only">Filter by directory</span>
              <select
                value={directory}
                onChange={(event) => setDirectory(event.target.value)}
                className="field w-auto"
              >
                <option value="">All directories</option>
                {topFolders.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="button-secondary bg-card" onClick={() => fitTo(null)}>
            Fit to screen
          </button>
          <button
            type="button"
            className="button-secondary bg-card"
            onClick={() => setLayoutRun((run) => run + 1)}
          >
            Reset layout
          </button>
          <button type="button" className="button-secondary bg-card" onClick={closeAll}>
            Collapse folders
          </button>
        </div>
      </div>

      <aside
        aria-label="Graph legend and filters"
        className="absolute bottom-3 left-3 max-w-[calc(100%-5rem)] rounded-md border border-line bg-card/95 p-3 text-xs"
      >
        <details open={legendOpen}>
        <summary
          className="cursor-pointer text-muted"
          onClick={(event) => {
            event.preventDefault();
            setLegendOpen(!legendOpen);
          }}
        >
          Legend and filters
        </summary>
        <fieldset className="mt-2">
          <legend className="mb-1 text-muted">Relationships</legend>
          {RELATIONSHIP_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={!hiddenTypes.has(type)}
                onChange={() => setHiddenTypes(toggle(hiddenTypes, type))}
              />
              <svg width="28" height="6" aria-hidden>
                <line
                  x1="0"
                  y1="3"
                  x2="28"
                  y2="3"
                  stroke="#9ca3af"
                  strokeWidth={EDGE_STYLES[type].width}
                  strokeDasharray={EDGE_STYLES[type].dash}
                />
              </svg>
              {EDGE_STYLES[type].label}
            </label>
          ))}
        </fieldset>
        {languages.length > 1 && (
          <fieldset className="mt-2">
            <legend className="mb-1 text-muted">Languages</legend>
            <div className="flex flex-wrap gap-x-3">
              {languages.map((language) => (
                <label key={language} className="flex items-center gap-1 py-0.5">
                  <input
                    type="checkbox"
                    checked={!hiddenLanguages.has(language)}
                    onChange={() => setHiddenLanguages(toggle(hiddenLanguages, language))}
                  />
                  {language}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        </details>
      </aside>

      {selectedFile && (
        <FilePanel
          repositoryId={source.repositoryId}
          analysisId={source.analysisId}
          data={data}
          cycles={data.cycles}
          file={selectedFile}
          repositoryUrl={source.repositoryUrl}
          commitSha={source.commitSha}
          hideUnrelated={hideUnrelated}
          onHideUnrelatedChange={setHideUnrelated}
          onOpenFile={revealFile}
          onClose={() => setSelected(null)}
        />
      )}

      {!positions && !layoutFailed && (
        <p role="status" className="absolute inset-0 flex items-center justify-center text-sm text-muted">
          Arranging {view.nodes.length.toLocaleString("en-US")} nodes…
        </p>
      )}
      {layoutFailed && (
        <p role="alert" className="absolute inset-0 flex items-center justify-center text-sm text-danger">
          We couldn&apos;t arrange this graph. Try collapsing some folders.
        </p>
      )}
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="m-4 rounded-md border border-dashed border-line p-8">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}
