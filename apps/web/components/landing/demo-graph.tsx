"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { DEMO_NODE, type DemoGraph as Graph, type DemoNode } from "@/lib/graph/demo-layout";

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "var(--lang-ts)",
  TSX: "var(--lang-tsx)",
  JavaScript: "var(--lang-js)",
  JSX: "var(--lang-jsx)",
};

const SHOWN_IMPORTERS = 6;

function shortName(path: string): string {
  const name = path.split("/").slice(-2).join("/");
  return name.length > 22 ? `…${name.slice(-21)}` : name;
}

/**
 * The home page's live thing: a real repository's graph where any file can be picked, by pointer or
 * keyboard, to light up what imports it and what it imports.
 */
export function DemoGraph({ graph, initialPath }: { graph: Graph; initialPath: string | null }) {
  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const [selected, setSelected] = useState<number | null>(
    () => graph.nodes.find((node) => node.path === initialPath)?.id ?? null,
  );

  const relations = useMemo(() => {
    if (selected === null) return null;
    const importers = graph.edges.filter((edge) => edge.target === selected).map((edge) => edge.source);
    const imports = graph.edges.filter((edge) => edge.source === selected).map((edge) => edge.target);

    // Everything that reaches this file through imports, directly or not.
    const seen = new Set<number>();
    const queue = [selected];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of graph.edges) {
        if (edge.target === current && edge.source !== selected && !seen.has(edge.source)) {
          seen.add(edge.source);
          queue.push(edge.source);
        }
      }
    }
    return { importers: new Set(importers), imports: new Set(imports), reach: seen.size };
  }, [graph.edges, selected]);

  function roleOf(node: DemoNode): string | undefined {
    if (!relations) return undefined;
    if (node.id === selected) return "selected";
    if (relations.importers.has(node.id)) return "importer";
    if (relations.imports.has(node.id)) return "import";
    return undefined;
  }

  function onKeyDown(event: KeyboardEvent<SVGGElement>, id: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelected(id);
    } else if (event.key === "Escape") {
      setSelected(null);
    }
  }

  const file = selected !== null ? byId.get(selected) : undefined;
  const importers = relations ? [...relations.importers].map((id) => byId.get(id)!) : [];
  const pad = 12;

  return (
    <div className="demo-body">
      <div className="demo-graph graph-scroll">
        <svg
          className="demo-svg"
          viewBox={`${-pad} ${-pad} ${graph.width + pad * 2} ${graph.height + pad * 2}`}
          role="group"
          aria-label={`Dependency graph with ${graph.nodes.length} connected files. Pick a file to see what imports it.`}
          data-active={relations ? "" : undefined}
        >
          <g aria-hidden>
            {graph.edges.map((edge) => {
              const a = byId.get(edge.source)!;
              const b = byId.get(edge.target)!;
              const x1 = a.x + DEMO_NODE.width;
              const y1 = a.y + DEMO_NODE.height / 2;
              const x2 = b.x;
              const y2 = b.y + DEMO_NODE.height / 2;
              const mid = (x1 + x2) / 2;
              const role =
                edge.target === selected ? "in" : edge.source === selected ? "out" : undefined;
              return (
                <path
                  key={`${edge.source}>${edge.target}`}
                  className="demo-edge"
                  d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                  data-type={edge.type}
                  data-role={role}
                />
              );
            })}
          </g>
          <g>
            {graph.nodes.map((node) => (
              <g
                key={node.id}
                className="demo-node"
                transform={`translate(${node.x},${node.y})`}
                tabIndex={0}
                role="button"
                aria-pressed={node.id === selected}
                aria-label={`${node.path}, ${node.language}`}
                data-role={roleOf(node)}
                onClick={() => setSelected(node.id)}
                onKeyDown={(event) => onKeyDown(event, node.id)}
              >
                <title>{node.path}</title>
                <rect width={DEMO_NODE.width} height={DEMO_NODE.height} rx={6} />
                <circle cx={12} cy={DEMO_NODE.height / 2} r={4} fill={LANGUAGE_COLORS[node.language] ?? "#94a3b8"} />
                <text x={22} y={DEMO_NODE.height / 2 + 4}>
                  {shortName(node.path)}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>

      <aside className="readout" aria-live="polite" aria-label="Picked file">
        {!file || !relations ? (
          <p className="readout-empty">Pick any file in the graph.</p>
        ) : (
          <>
            <h3>{file.path}</h3>
            <p className="readout-meta">
              {file.language} · {file.lines.toLocaleString("en-US")} lines
            </p>
            <dl className="readout-stats">
              <div className="stat stat-in">
                <dt>import it</dt>
                <dd>{relations.importers.size}</dd>
              </div>
              <div className="stat stat-out">
                <dt>it imports</dt>
                <dd>{relations.imports.size}</dd>
              </div>
            </dl>
            <p className="readout-reach">
              A change here reaches <strong>{relations.reach}</strong>{" "}
              {relations.reach === 1 ? "file" : "files"}.
            </p>
            {importers.length > 0 ? (
              <>
                <ul className="readout-list">
                  {importers.slice(0, SHOWN_IMPORTERS).map((other) => (
                    <li key={other.id}>{other.path}</li>
                  ))}
                </ul>
                {importers.length > SHOWN_IMPORTERS && (
                  <p className="readout-more">and {importers.length - SHOWN_IMPORTERS} more</p>
                )}
              </>
            ) : (
              <p className="readout-empty">Nothing imports this file.</p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
