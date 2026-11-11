"use client";

import { Minus, Pause, Play, Plus, Scan } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraph3DInstance } from "3d-force-graph";
import type { Object3D } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { clusterKeys, clusterOrder } from "@/lib/graph/clusters";
import type { GraphEdge, GraphFile, RelationshipType } from "@/lib/graph/types";
import { CLUSTER_COLORS, ORPHAN_COLOR } from "@/lib/ui/colors";
import { prefersReducedMotion } from "@/lib/ui/layout";

type Node3D = {
  id: number;
  path: string;
  language: string;
  incoming: number;
  outgoing: number;
  cluster: string;
  orphan: boolean;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
};

type Link3D = { source: number | Node3D; target: number | Node3D; type: RelationshipType };

type Instance = ForceGraph3DInstance<Node3D, Link3D>;
type Three = typeof import("three");

/** How many of the most-imported files get a name floating beside them. */
const LABELLED_HUBS = 6;

type Props = {
  files: GraphFile[];
  edges: GraphEdge[];
  selectedId: number | null;
  /** Files whose change is being followed, and the files it reaches. */
  impact: { sources: Set<number>; affected: Set<number> } | null;
  /** Bumped to fly the camera to the selected file. */
  flyRequest: number;
  onSelect: (id: number | null) => void;
};

const SELECTED = "#ffffff";
const IMPORTER = "#22c55e";
const IMPORTED = "#60a5fa";
const IMPACTED = "#e0a458";
const FADED = "#1e293b";
// The post-processing brightens dark colours, so only true black stays black.
const BACKGROUND = "#000000";

const endId = (end: number | Node3D) => (typeof end === "number" ? end : end.id);

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Spreads cluster centres evenly over a sphere, biggest cluster first, wider for bigger graphs. */
function sphereCentres(count: number, fileCount: number) {
  const radius = 30 + 6 * Math.sqrt(fileCount);
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    if (count === 1) return { x: 0, y: 0, z: 0 };
    const y = 1 - (i / (count - 1)) * 2;
    const theta = golden * i;
    const ring = Math.sqrt(1 - y * y);
    return { x: Math.cos(theta) * ring * radius, y: y * radius, z: Math.sin(theta) * ring * radius };
  });
}

/** A file name drawn on a canvas and shown as a sprite that always faces the camera. */
function nameSprite(three: Three, text: string, radius: number) {
  const size = 32;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  const font = `600 ${size}px "JetBrains Mono", ui-monospace, monospace`;
  context.font = font;
  canvas.width = Math.ceil(context.measureText(text).width) + 16;
  canvas.height = size + 16;
  context.font = font;
  context.fillStyle = "rgba(226, 232, 240, 0.92)";
  context.textBaseline = "middle";
  context.fillText(text, 8, canvas.height / 2);

  const texture = new three.CanvasTexture(canvas);
  texture.colorSpace = three.SRGBColorSpace;
  const sprite = new three.Sprite(new three.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  const scale = 0.16;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  sprite.position.set(0, radius + (canvas.height * scale) / 2 + 2, 0);
  return sprite;
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Every file as a glowing point and every import as a line, in space you can turn, pan and zoom.
 * Files cluster by folder and take its colour; the more a file is imported, the bigger it is.
 * Picking a file lights what imports it in green and what it imports in blue.
 */
export function Graph3D({ files, edges, selectedId, impact, flyRequest, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const graph = useRef<Instance | null>(null);
  const three = useRef<Three | null>(null);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  // Only drawn in the browser, after the graph data has arrived.
  const [failed, setFailed] = useState(() => typeof document !== "undefined" && !webglAvailable());
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const clusters = useMemo(() => {
    const keys = clusterKeys(files);
    const order = clusterOrder(keys);
    const colors = new Map(order.map((key, index) => [key, CLUSTER_COLORS[index % CLUSTER_COLORS.length]!]));
    const centres = new Map(sphereCentres(order.length, files.length).map((centre, index) => [order[index]!, centre]));
    return { keys, order, colors, centres };
  }, [files]);

  // The scene is made once; the data and colours below update it in place.
  useEffect(() => {
    const element = host.current;
    if (!element || failed) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;

    (async () => {
      const [{ default: ForceGraph3D }, { UnrealBloomPass }, threeModule] = await Promise.all([
        import("3d-force-graph"),
        import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
        import("three"),
      ]);
      if (disposed) return;
      three.current = threeModule;
      const { Vector2 } = threeModule;

      const instance = new ForceGraph3D(element, { controlType: "orbit" }) as unknown as Instance;
      instance
        .backgroundColor(BACKGROUND)
        .showNavInfo(false)
        .width(element.clientWidth)
        .height(element.clientHeight)
        .nodeRelSize(3)
        .nodeResolution(14)
        .nodeOpacity(0.95)
        .linkOpacity(0.45)
        .linkDirectionalParticleWidth(1.6)
        .linkDirectionalParticleSpeed(0.006)
        .cooldownTime(6000)
        .onNodeClick((node) => onSelectRef.current(node.id))
        .onBackgroundClick(() => onSelectRef.current(null));

      const bloom = new UnrealBloomPass(new Vector2(element.clientWidth, element.clientHeight), 0.9, 0.1, 0.15);
      instance.postProcessingComposer().addPass(bloom);

      const controls = instance.controls() as OrbitControls;
      controls.autoRotateSpeed = 0.5;
      controls.enableDamping = true;

      let fitted = false;
      instance.onEngineStop(() => {
        if (fitted) return;
        fitted = true;
        instance.zoomToFit(prefersReducedMotion() ? 0 : 700, 40);
      });

      observer = new ResizeObserver(() => {
        instance.width(element.clientWidth).height(element.clientHeight);
      });
      observer.observe(element);

      graph.current = instance;
      setReady(true);
      setRotating(!prefersReducedMotion());
    })().catch(() => {
      if (!disposed) setFailed(true);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      graph.current?._destructor();
      graph.current = null;
    };
    // The scene is made once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Files and imports. A new set restarts the layout.
  useEffect(() => {
    const instance = graph.current;
    if (!ready || !instance) return;
    const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
    const nodes: Node3D[] = files.map((file) => ({
      id: file.id,
      path: file.path,
      language: file.language,
      incoming: file.incoming,
      outgoing: file.outgoing,
      cluster: clusters.keys.get(file.id) ?? "(root)",
      orphan: !connected.has(file.id),
    }));
    const links: Link3D[] = edges
      .filter((edge) => edge.source !== edge.target)
      .map((edge) => ({ source: edge.source, target: edge.target, type: edge.type }));

    // A gentle pull towards each folder's own place, so folders read as regions.
    let simulated: Node3D[] = [];
    const clusterForce = Object.assign(
      (alpha: number) => {
        for (const node of simulated) {
          const centre = clusters.centres.get(node.cluster);
          if (!centre || node.x === undefined || node.y === undefined || node.z === undefined) continue;
          const pull = node.orphan ? 0.1 : 0.06;
          node.vx = (node.vx ?? 0) + (centre.x - node.x) * alpha * pull;
          node.vy = (node.vy ?? 0) + (centre.y - node.y) * alpha * pull;
          node.vz = (node.vz ?? 0) + (centre.z - node.z) * alpha * pull;
        }
      },
      { initialize: (all: Node3D[]) => (simulated = all) },
    );
    instance.d3Force("cluster", clusterForce);

    const hubs = new Set(
      [...files]
        .filter((file) => file.incoming > 0)
        .sort((a, b) => b.incoming - a.incoming || a.path.localeCompare(b.path))
        .slice(0, LABELLED_HUBS)
        .map((file) => file.id),
    );
    const nodeVal = (node: Node3D) => 1 + node.incoming * 1.4;
    instance
      .nodeThreeObjectExtend(true)
      // Returning nothing keeps the plain sphere; the library's types don't say so.
      .nodeThreeObject((node) => {
        const none = null as unknown as Object3D;
        if (!hubs.has(node.id) || !three.current) return none;
        const name = node.path.slice(node.path.lastIndexOf("/") + 1);
        return nameSprite(three.current, name, 3 * Math.cbrt(nodeVal(node))) ?? none;
      })
      .nodeVal(nodeVal)
      .nodeLabel(
        (node) =>
          `<div class="graph3d-label"><strong>${escapeHtml(node.path)}</strong><span>${node.incoming} import it · it imports ${node.outgoing}</span></div>`,
      )
      .graphData({ nodes, links });
  }, [ready, files, edges, clusters]);

  // Colours follow the selection and the change being followed.
  const related = useMemo(() => {
    if (selectedId === null) return null;
    return {
      importers: new Set(edges.filter((edge) => edge.target === selectedId).map((edge) => edge.source)),
      imported: new Set(edges.filter((edge) => edge.source === selectedId).map((edge) => edge.target)),
    };
  }, [edges, selectedId]);

  useEffect(() => {
    const instance = graph.current;
    if (!ready || !instance) return;
    const motion = !prefersReducedMotion();

    const nodeColor = (node: Node3D) => {
      if (impact) {
        if (impact.sources.has(node.id)) return SELECTED;
        return impact.affected.has(node.id) ? IMPACTED : FADED;
      }
      if (related) {
        if (node.id === selectedId) return SELECTED;
        if (related.importers.has(node.id)) return IMPORTER;
        if (related.imported.has(node.id)) return IMPORTED;
        return FADED;
      }
      return node.orphan ? ORPHAN_COLOR : (clusters.colors.get(node.cluster) ?? ORPHAN_COLOR);
    };

    const linkRole = (link: Link3D): "in" | "out" | "impact" | "faded" | "base" => {
      const source = endId(link.source);
      const target = endId(link.target);
      if (impact) {
        const reached = impact.affected.has(source) && (impact.affected.has(target) || impact.sources.has(target));
        return reached ? "impact" : "faded";
      }
      if (selectedId === null) return "base";
      if (target === selectedId) return "in";
      if (source === selectedId) return "out";
      return "faded";
    };

    instance
      .nodeColor(nodeColor)
      .linkColor((link) => {
        const role = linkRole(link);
        if (role === "in") return IMPORTER;
        if (role === "out") return IMPORTED;
        if (role === "impact") return IMPACTED;
        if (role === "faded") return "#162033";
        const source = typeof link.source === "number" ? undefined : link.source;
        return source ? (clusters.colors.get(source.cluster) ?? ORPHAN_COLOR) : ORPHAN_COLOR;
      })
      .linkWidth((link) => (["in", "out", "impact"].includes(linkRole(link)) ? 0.9 : 0))
      .linkDirectionalParticles((link) => (motion && ["in", "out"].includes(linkRole(link)) ? 2 : 0));
  }, [ready, related, impact, selectedId, clusters]);

  // Fly to the picked file when asked, for example after a search.
  useEffect(() => {
    const instance = graph.current;
    if (!ready || !instance || selectedId === null || flyRequest === 0) return;
    const node = instance.graphData().nodes.find((candidate) => candidate.id === selectedId);
    if (!node || node.x === undefined || node.y === undefined || node.z === undefined) return;
    const distance = 90;
    const length = Math.hypot(node.x, node.y, node.z) || 1;
    const ratio = 1 + distance / length;
    instance.cameraPosition(
      { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio },
      { x: node.x, y: node.y, z: node.z },
      prefersReducedMotion() ? 0 : 900,
    );
    // Only a new request should move the camera, not every selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, flyRequest]);

  useEffect(() => {
    const instance = graph.current;
    if (!ready || !instance) return;
    (instance.controls() as OrbitControls).autoRotate = rotating;
  }, [ready, rotating]);

  function zoom(factor: number) {
    const instance = graph.current;
    if (!instance) return;
    const controls = instance.controls() as OrbitControls;
    const target = controls.target;
    const camera = instance.cameraPosition();
    instance.cameraPosition(
      {
        x: target.x + (camera.x - target.x) * factor,
        y: target.y + (camera.y - target.y) * factor,
        z: target.z + (camera.z - target.z) * factor,
      },
      { x: target.x, y: target.y, z: target.z },
      prefersReducedMotion() ? 0 : 300,
    );
  }

  if (failed) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
        This browser can&apos;t draw 3D graphics. Pick another layout to see the graph.
      </div>
    );
  }

  return (
    // With a file open, the scene keeps clear of the file panel instead of sitting under it.
    <div
      className={`absolute inset-y-0 left-0 bg-black ${
        selectedId !== null ? "right-0 sm:right-[var(--panel-width)]" : "right-0"
      }`}
    >
      <div
        ref={host}
        className="graph3d absolute inset-0"
        role="img"
        aria-label={`3D graph of ${files.length.toLocaleString("en-US")} files. Drag to turn it, scroll or pinch to zoom, right-drag to pan. Search picks a file by keyboard.`}
      />
      {!ready && (
        <p role="status" className="pointer-events-none absolute top-1/2 left-1/2 -translate-1/2 text-sm text-muted">
          Drawing the 3D graph…
        </p>
      )}
      {ready && (
        <div
          className="pointer-events-none absolute right-3 bottom-3 flex items-end gap-2"
        >
          <ClusterKey order={clusters.order} colors={clusters.colors} />
          <div className="pointer-events-auto flex flex-col gap-1.5" role="group" aria-label="3D view">
            <ControlButton label="Zoom in" onClick={() => zoom(0.7)}>
              <Plus size={18} aria-hidden />
            </ControlButton>
            <ControlButton label="Zoom out" onClick={() => zoom(1.4)}>
              <Minus size={18} aria-hidden />
            </ControlButton>
            <ControlButton
              label="Fit everything"
              onClick={() => graph.current?.zoomToFit(prefersReducedMotion() ? 0 : 600, 40)}
            >
              <Scan size={18} aria-hidden />
            </ControlButton>
            <ControlButton
              label={rotating ? "Stop turning" : "Turn slowly"}
              pressed={rotating}
              onClick={() => setRotating((value) => !value)}
            >
              {rotating ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
            </ControlButton>
          </div>
        </div>
      )}
    </div>
  );
}

function ControlButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="flex size-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-card/90 text-foreground transition-colors duration-150 hover:border-muted hover:bg-elevated"
    >
      {children}
    </button>
  );
}

const SHOWN_CLUSTERS = 8;

function ClusterKey({ order, colors }: { order: string[]; colors: Map<string, string> }) {
  return (
    <ul
      aria-label="Folder colours"
      className="hidden max-w-56 space-y-1 rounded-lg border border-line bg-card/85 p-3 font-mono text-xs md:block"
    >
      {order.slice(0, SHOWN_CLUSTERS).map((key) => (
        <li key={key} className="flex items-center gap-2 truncate">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: colors.get(key), boxShadow: `0 0 8px ${colors.get(key)}` }}
            aria-hidden
          />
          <span className="truncate">{key}</span>
        </li>
      ))}
      {order.length > SHOWN_CLUSTERS && (
        <li className="text-muted">and {order.length - SHOWN_CLUSTERS} more folders</li>
      )}
    </ul>
  );
}
