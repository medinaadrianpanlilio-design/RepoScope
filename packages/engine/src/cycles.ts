type Frame = { node: string; next: number };

/**
 * Tarjan's strongly connected components, written with an explicit stack so a long
 * dependency chain can't overflow the call stack. Returns groups of files that can
 * reach each other, including a file that imports itself.
 */
export function findCycles(nodes: Iterable<string>, adjacency: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;

  const enter = (node: string): Frame => {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    return { node, next: 0 };
  };

  for (const start of nodes) {
    if (index.has(start)) continue;
    const frames = [enter(start)];

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const neighbors = adjacency.get(frame.node) ?? [];

      if (frame.next < neighbors.length) {
        const neighbor = neighbors[frame.next++]!;
        if (!index.has(neighbor)) {
          frames.push(enter(neighbor));
        } else if (onStack.has(neighbor)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(neighbor)!));
        }
        continue;
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));

      if (low.get(frame.node) === index.get(frame.node)) {
        const group: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          group.push(member);
        } while (member !== frame.node);

        if (group.length > 1 || neighbors.includes(frame.node)) cycles.push(group.sort());
      }
    }
  }

  return cycles.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
}
