import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

type Request = {
  requestId: number;
  nodes: { id: string; width: number; height: number }[];
  edges: { id: string; source: string; target: string }[];
};

// Runs off the main thread, because laying out a large graph can take seconds.
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  const { requestId, nodes, edges } = data;

  try {
    const result = await elk.layout({
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.layered.spacing.nodeNodeBetweenLayers": "90",
        "elk.spacing.nodeNode": "18",
        "elk.spacing.componentComponent": "60",
      },
      children: nodes,
      edges: edges.map(({ id, source, target }) => ({ id, sources: [source], targets: [target] })),
    });

    const positions = Object.fromEntries(
      (result.children ?? []).map(({ id, x, y }) => [id, { x: x ?? 0, y: y ?? 0 }]),
    );
    self.postMessage({ requestId, positions });
  } catch {
    self.postMessage({ requestId, error: true });
  }
};
