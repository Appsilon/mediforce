/**
 * Layered layout for the workflow canvas.
 *
 * Every path a workflow can take is placed — a branch is never collapsed, so a
 * step is never hidden behind a choice the reader has to guess at. Layers run
 * top-to-bottom (a step sits below everything that feeds it) and branches fan
 * out into columns.
 *
 * Edges are drawn as straight smoothstep paths between node centres, so an edge
 * that skips a layer would cut through whatever sits in its column on the way
 * down. The column assignment therefore reserves that column across the layers
 * such an edge crosses, and pushes the other steps of those layers aside.
 */

export const NODE_WIDTH = 240;
export const COLUMN_GAP = 40;
export const ROW_GAP = 58;
const CANVAS_PADDING = 40;

export type GraphEdge = { from: string; to: string; label?: string };

/** A graph edge plus whether it loops back to a step the run already passed. */
export type PlacedEdge = GraphEdge & { isBack: boolean };

export type GraphLayout = {
  /** Node ids in traversal order — the tie-break for column assignment. */
  order: string[];
  /** Every edge, in the same top-down order as `order`. */
  edges: PlacedEdge[];
  positions: Map<string, { x: number; y: number }>;
  height: number;
};

const edgeKey = (edge: GraphEdge) => `${edge.from}->${edge.to}`;

function outgoingByNode(nodeIds: string[], edges: GraphEdge[]) {
  const outgoing = new Map<string, GraphEdge[]>(nodeIds.map((id) => [id, []]));
  const hasIncoming = new Set<string>();
  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge);
    hasIncoming.add(edge.to);
  }
  return { outgoing, hasIncoming };
}

/**
 * Depth-first traversal that names the back edges: an edge is a back edge only
 * when its target is still on the stack, i.e. it closes a cycle. An edge into an
 * already-finished step (two branches merging again) stays forward.
 */
function traverse(nodeIds: string[], outgoing: Map<string, GraphEdge[]>, hasIncoming: Set<string>) {
  const roots = nodeIds.filter((id) => hasIncoming.has(id) === false);
  const order: string[] = [];
  const seen = new Set<string>();
  const onStack = new Set<string>();
  const backEdges = new Set<string>();

  const enter = (id: string) => {
    seen.add(id);
    onStack.add(id);
    order.push(id);
  };

  // Roots first so the traversal follows the workflow's entry points; the plain
  // node list then covers anything left over (a cycle with no entry at all).
  for (const start of [...roots, ...nodeIds]) {
    if (seen.has(start) === true) continue;
    enter(start);
    const frames: Array<{ id: string; next: number }> = [{ id: start, next: 0 }];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const outs = outgoing.get(frame.id) ?? [];
      if (frame.next >= outs.length) {
        onStack.delete(frame.id);
        frames.pop();
        continue;
      }
      const edge = outs[frame.next++];
      if (onStack.has(edge.to) === true) {
        backEdges.add(edgeKey(edge));
        continue;
      }
      if (seen.has(edge.to) === true) continue;
      enter(edge.to);
      frames.push({ id: edge.to, next: 0 });
    }
  }

  return { order, backEdges };
}

/** Longest path from any root, so a step always lands below every step feeding it. */
function computeDepths(order: string[], forwardEdges: GraphEdge[]): Map<string, number> {
  const children = new Map<string, string[]>();
  const indegree = new Map<string, number>(order.map((id) => [id, 0]));
  for (const edge of forwardEdges) {
    children.set(edge.from, [...(children.get(edge.from) ?? []), edge.to]);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const depth = new Map<string, number>(order.map((id) => [id, 0]));
  const queue = order.filter((id) => indegree.get(id) === 0);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of children.get(current) ?? []) {
      depth.set(child, Math.max(depth.get(child) ?? 0, (depth.get(current) ?? 0) + 1));
      indegree.set(child, (indegree.get(child) ?? 1) - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
  }
  return depth;
}

function assignColumns(order: string[], forwardEdges: PlacedEdge[], depth: Map<string, number>): Map<string, number> {
  const orderIdx = new Map(order.map((id, idx) => [id, idx]));
  const parents = new Map<string, string[]>();
  for (const edge of forwardEdges) {
    parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);
  }

  const byDepth = new Map<number, string[]>();
  for (const id of order) {
    const d = depth.get(id) ?? 0;
    byDepth.set(d, [...(byDepth.get(d) ?? []), id]);
  }

  const column = new Map<string, number>();
  const maxDepth = Math.max(0, ...byDepth.keys());
  for (let level = 0; level <= maxDepth; level++) {
    // Lanes claimed by edges passing straight through this level.
    const taken = new Set<number>();
    for (const edge of forwardEdges) {
      const from = depth.get(edge.from) ?? 0;
      const to = depth.get(edge.to) ?? 0;
      if (from < level && level < to) taken.add(column.get(edge.from) ?? 0);
    }

    // A step prefers the column of its earliest parent — the one whose edge
    // spans the most levels, and therefore the one that needs a straight drop.
    const candidates = (byDepth.get(level) ?? []).map((id) => {
      const anchor = (parents.get(id) ?? []).slice().sort(
        (a, b) => (depth.get(a)! - depth.get(b)!) || (orderIdx.get(a)! - orderIdx.get(b)!),
      )[0];
      return { id, preferred: anchor === undefined ? 0 : column.get(anchor) ?? 0 };
    });
    candidates.sort((a, b) => (a.preferred - b.preferred) || (orderIdx.get(a.id)! - orderIdx.get(b.id)!));

    for (const candidate of candidates) {
      let target = candidate.preferred;
      while (taken.has(target) === true) target++;
      taken.add(target);
      column.set(candidate.id, target);
    }
  }
  return column;
}

/**
 * Lays out `nodeIds` connected by `edges`. Edges naming a node outside `nodeIds`
 * are dropped; self-loops and cycle-closing edges come back as `isBack` so the
 * caller can route them around the side instead of through the layers.
 *
 * `heightOf` is told how many back edges leave the node, because the card grows
 * a row per loop it can take.
 */
export function computeGraphLayout(
  nodeIds: string[],
  edges: GraphEdge[],
  heightOf: (nodeId: string, outgoingBackEdges: number) => number,
): GraphLayout {
  const known = new Set(nodeIds);
  const graphEdges = edges.filter((edge) => known.has(edge.from) === true && known.has(edge.to) === true);
  const { outgoing, hasIncoming } = outgoingByNode(nodeIds, graphEdges);
  const { order, backEdges } = traverse(nodeIds, outgoing, hasIncoming);

  // Sorted by where their source sits in the traversal, so the edge list reads
  // top-down like the canvas does. The canvas renders each edge's inline
  // "add step here" button in this order, so the first one belongs to the first
  // step of the workflow rather than to whichever step happened to declare a
  // verdict.
  const orderIdx = new Map(order.map((id, idx) => [id, idx]));
  const placedEdges: PlacedEdge[] = graphEdges
    .map((edge) => ({
      ...edge,
      isBack: edge.from === edge.to || backEdges.has(edgeKey(edge)) === true,
    }))
    .sort(
      (a, b) =>
        (orderIdx.get(a.from)! - orderIdx.get(b.from)!) || (orderIdx.get(a.to)! - orderIdx.get(b.to)!),
    );
  const forwardEdges = placedEdges.filter((edge) => edge.isBack === false);

  const depth = computeDepths(order, forwardEdges);
  const column = assignColumns(order, forwardEdges, depth);

  const backEdgeCount = new Map<string, number>();
  for (const edge of placedEdges) {
    if (edge.isBack === true) backEdgeCount.set(edge.from, (backEdgeCount.get(edge.from) ?? 0) + 1);
  }

  const rowHeights = new Map<number, number>();
  for (const id of order) {
    const level = depth.get(id) ?? 0;
    rowHeights.set(level, Math.max(rowHeights.get(level) ?? 0, heightOf(id, backEdgeCount.get(id) ?? 0)));
  }

  const yByDepth = new Map<number, number>();
  const maxDepth = Math.max(0, ...depth.values());
  let cursorY = 0;
  for (let level = 0; level <= maxDepth; level++) {
    yByDepth.set(level, cursorY);
    cursorY += (rowHeights.get(level) ?? 0) + ROW_GAP;
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const id of order) {
    positions.set(id, {
      x: (column.get(id) ?? 0) * (NODE_WIDTH + COLUMN_GAP),
      y: yByDepth.get(depth.get(id) ?? 0) ?? 0,
    });
  }

  return { order, edges: placedEdges, positions, height: cursorY + CANVAS_PADDING };
}

/** A node as the canvas currently holds it: where it sits and how tall it is. */
export type AnchoredNode = { id: string; position: { x: number; y: number }; height: number };

function overlapsSomething(
  x: number,
  y: number,
  height: number,
  positioned: Map<string, { x: number; y: number }>,
  heightById: Map<string, number>,
  ignore: Set<string>,
): boolean {
  return [...positioned].some(([id, position]) => {
    const otherHeight = heightById.get(id);
    if (otherHeight === undefined || ignore.has(id) === true) return false;
    return Math.abs(position.x - x) < NODE_WIDTH && position.y < y + height && y < position.y + otherHeight;
  });
}

/**
 * Positions for a re-rendered canvas. Nodes already on it keep whatever position
 * the user dragged them to; each brand-new node is anchored below its parent and
 * slides right until it finds a column nothing else occupies at that height — so
 * a block added on one branch never lands on top of the branch beside it.
 *
 * The nodes the new one now feeds are exempt from that search and are pushed
 * down instead, which keeps a step inserted mid-path in line with that path.
 * That push travels the whole way down: a step two arrows below the insertion
 * has to make room as well, or the path lands on top of itself. Only steps the
 * insertion actually crowds move, so a gap the user dragged open survives.
 */
export function placeNewNodes(
  previous: AnchoredNode[],
  current: AnchoredNode[],
  forwardEdges: GraphEdge[],
): Map<string, { x: number; y: number }> {
  const previousIds = new Set(previous.map((node) => node.id));
  const heightById = new Map(current.map((node) => [node.id, node.height]));
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const edge of forwardEdges) {
    parentsOf.set(edge.to, [...(parentsOf.get(edge.to) ?? []), edge.from]);
    childrenOf.set(edge.from, [...(childrenOf.get(edge.from) ?? []), edge.to]);
  }

  const positioned = new Map(previous.map((node) => [node.id, node.position]));
  const newNodes = current.filter((node) => previousIds.has(node.id) === false);

  for (const node of newNodes) {
    const parents = parentsOf.get(node.id) ?? [];
    const parentPosition = parents.length === 1 ? positioned.get(parents[0]) : undefined;
    const anchor = parentPosition
      ? { x: parentPosition.x, y: parentPosition.y + (heightById.get(parents[0]) ?? node.height) + ROW_GAP }
      : node.position;
    const ignore = new Set(childrenOf.get(node.id) ?? []);
    let x = anchor.x;
    while (overlapsSomething(x, anchor.y, node.height, positioned, heightById, ignore) === true) {
      x += NODE_WIDTH + COLUMN_GAP;
    }
    positioned.set(node.id, { x, y: anchor.y });
  }

  // Walk the path top-down — a step always sits at a greater depth than the one
  // feeding it — so a step that moves has already moved by the time the steps it
  // feeds are looked at, and one pass carries the insertion down to the terminal.
  const depth = computeDepths(current.map((node) => node.id), forwardEdges);
  const crowded = new Set(newNodes.map((node) => node.id));
  const topDown = [...current].sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0));

  for (const node of topDown) {
    if (crowded.has(node.id) === false) continue;
    const placed = positioned.get(node.id);
    if (placed === undefined) continue;
    const requiredY = placed.y + node.height + ROW_GAP;
    for (const childId of childrenOf.get(node.id) ?? []) {
      const childPosition = positioned.get(childId);
      if (childPosition === undefined || childPosition.y >= requiredY) continue;
      positioned.set(childId, { ...childPosition, y: requiredY });
      crowded.add(childId);
    }
  }

  return positioned;
}
