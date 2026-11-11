import ELK from "elkjs/lib/elk.bundled.js";
import { elkGraph, readLayout, type LayoutEdge, type LayoutKind, type LayoutNode } from "./layouts";

const elk = new ELK();

type Request = {
  requestId: number;
  layout: LayoutKind;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
};

// Runs off the main thread, because laying out a large graph can take seconds.
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  const { requestId, layout, nodes, edges } = data;

  try {
    const result = await elk.layout(elkGraph(layout, nodes, edges));
    self.postMessage({ requestId, ...readLayout(result) });
  } catch {
    self.postMessage({ requestId, error: true });
  }
};
