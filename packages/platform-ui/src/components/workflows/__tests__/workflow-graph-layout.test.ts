import { describe, it, expect } from 'vitest';
import { computeGraphLayout, placeNewNodes, NODE_WIDTH, COLUMN_GAP } from '../workflow-graph-layout';

const COLUMN_PITCH = NODE_WIDTH + COLUMN_GAP;
const columnOf = (x: number) => Math.round(x / COLUMN_PITCH);

/** Shape of `tealflow-auto-code-generation`: a decision that either skips or
 *  goes through an upload step, a revise loop, and a long jump to the terminal. */
const tealflow = {
  nodes: ['collect', 'source-decision', 'provide-data', 'build', 'review', 'test', 'human-review', 'deploy', 'done'],
  edges: [
    { from: 'collect', to: 'source-decision' },
    { from: 'source-decision', to: 'build', label: 'use_demo' },
    { from: 'source-decision', to: 'provide-data', label: 'upload_data' },
    { from: 'provide-data', to: 'build' },
    { from: 'build', to: 'review' },
    { from: 'review', to: 'test' },
    { from: 'test', to: 'review', label: 'fail' },
    { from: 'test', to: 'human-review', label: 'pass' },
    { from: 'human-review', to: 'done', label: 'reject' },
    { from: 'human-review', to: 'build', label: 'revise' },
    { from: 'human-review', to: 'deploy', label: 'approve' },
    { from: 'deploy', to: 'done' },
  ],
};

const layoutTealflow = () => computeGraphLayout(tealflow.nodes, tealflow.edges, () => 100);

describe('computeGraphLayout', () => {
  it('[UNIT] places every step, including both sides of a branch', () => {
    const { positions } = layoutTealflow();

    for (const id of tealflow.nodes) {
      expect(positions.has(id), `${id} was dropped from the layout`).toBe(true);
    }
  });

  it('[UNIT] marks loops back but keeps a branch that merges again forward', () => {
    const { edges } = layoutTealflow();
    const isBack = (from: string, to: string) => edges.find((e) => e.from === from && e.to === to)?.isBack;

    expect(isBack('test', 'review')).toBe(true);
    expect(isBack('human-review', 'build')).toBe(true);
    expect(isBack('provide-data', 'build')).toBe(false);
    expect(isBack('source-decision', 'build')).toBe(false);
  });

  it('[UNIT] never stacks two steps on the same spot', () => {
    const { positions } = layoutTealflow();
    const spots = [...positions.values()].map((p) => `${p.x},${p.y}`);

    expect(new Set(spots).size).toBe(spots.length);
  });

  it('[UNIT] keeps the column of a level-skipping edge clear on the levels it crosses', () => {
    const { positions, edges } = layoutTealflow();

    for (const edge of edges) {
      if (edge.isBack) continue;
      const source = positions.get(edge.from)!;
      const target = positions.get(edge.to)!;
      for (const [id, position] of positions) {
        if (id === edge.from || id === edge.to) continue;
        const between = position.y > source.y && position.y < target.y;
        if (between && columnOf(position.x) === columnOf(source.x)) {
          throw new Error(`${id} sits in the lane of ${edge.from} -> ${edge.to}`);
        }
      }
    }
  });

  it('[UNIT] places a step below every step that feeds it', () => {
    const { positions, edges } = layoutTealflow();

    for (const edge of edges) {
      if (edge.isBack) continue;
      expect(positions.get(edge.to)!.y).toBeGreaterThan(positions.get(edge.from)!.y);
    }
  });

  it('[UNIT] returns the edges top-down, so the first one leaves the first step', () => {
    const { edges } = layoutTealflow();

    expect(edges[0]).toMatchObject({ from: 'collect', to: 'source-decision' });
  });

  it('[UNIT] lays out a step nothing connects to instead of dropping it', () => {
    const { positions } = computeGraphLayout(
      ['start', 'done', 'orphan'],
      [{ from: 'start', to: 'done' }],
      () => 100,
    );

    expect(positions.has('orphan')).toBe(true);
  });

  it('[UNIT] survives a graph whose every step is inside a cycle', () => {
    const { positions, edges } = computeGraphLayout(
      ['a', 'b'],
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
      () => 100,
    );

    expect(positions.size).toBe(2);
    expect(edges.filter((e) => e.isBack)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// placeNewNodes
// ---------------------------------------------------------------------------

describe('placeNewNodes', () => {
  const node = (id: string, x: number, y: number, height = 100) => ({ id, position: { x, y }, height });

  it('[UNIT] anchors a new branch node clear of the sibling already in that column', () => {
    // root -> A already on canvas; a block added on root -> B introduces B below root.
    const previous = [node('root', 0, 0), node('a', 0, 158)];
    const current = [...previous, node('b', 0, 0)];
    const edges = [{ from: 'root', to: 'a' }, { from: 'root', to: 'b' }];

    const positions = placeNewNodes(previous, current, edges);

    expect(positions.get('b')?.y).toBe(158);
    expect(columnOf(positions.get('b')?.x ?? 0)).toBe(1);
    expect(positions.get('a')).toEqual({ x: 0, y: 158 });
  });

  it('[UNIT] keeps a step inserted into a path in line and pushes its successor down', () => {
    const previous = [node('a', 0, 0), node('done', 0, 158)];
    const current = [...previous, node('mid', 0, 0)];
    const edges = [{ from: 'a', to: 'mid' }, { from: 'mid', to: 'done' }];

    const positions = placeNewNodes(previous, current, edges);

    expect(positions.get('mid')).toEqual({ x: 0, y: 158 });
    expect(positions.get('done')).toEqual({ x: 0, y: 316 });
  });

  it('[UNIT] pushes the whole path below an inserted step, not just its successor', () => {
    // a -> y -> z -> done on the canvas; a step inserted on the a -> y edge has
    // to clear every step further down the path, or y lands on top of z.
    const previous = [node('a', 0, 0), node('y', 0, 158), node('z', 0, 316), node('done', 0, 474)];
    const current = [...previous, node('x', 0, 0)];
    const edges = [
      { from: 'a', to: 'x' },
      { from: 'x', to: 'y' },
      { from: 'y', to: 'z' },
      { from: 'z', to: 'done' },
    ];

    const positions = placeNewNodes(previous, current, edges);

    expect(positions.get('x')).toEqual({ x: 0, y: 158 });
    expect(positions.get('y')).toEqual({ x: 0, y: 316 });
    expect(positions.get('z')).toEqual({ x: 0, y: 474 });
    expect(positions.get('done')).toEqual({ x: 0, y: 632 });
  });

  it('[UNIT] leaves a path that already has room where it is', () => {
    // Only the steps an insertion actually crowds move; a gap the user dragged
    // open further down the path survives the re-render.
    const previous = [node('a', 0, 0), node('y', 0, 158), node('z', 0, 900)];
    const current = [...previous, node('x', 0, 0)];
    const edges = [{ from: 'a', to: 'x' }, { from: 'x', to: 'y' }, { from: 'y', to: 'z' }];

    const positions = placeNewNodes(previous, current, edges);

    expect(positions.get('y')).toEqual({ x: 0, y: 316 });
    expect(positions.get('z')).toEqual({ x: 0, y: 900 });
  });

  it('[UNIT] staggers several new nodes sharing one parent instead of stacking them', () => {
    const previous = [node('root', 0, 0)];
    const current = [...previous, node('x', 0, 0), node('y', 0, 0)];
    const edges = [{ from: 'root', to: 'x' }, { from: 'root', to: 'y' }];

    const positions = placeNewNodes(previous, current, edges);

    expect(columnOf(positions.get('x')?.x ?? 0)).toBe(0);
    expect(columnOf(positions.get('y')?.x ?? 0)).toBe(1);
  });

  it('[UNIT] leaves a dragged position alone', () => {
    const previous = [node('root', 999, 42)];
    const current = [node('root', 0, 0)];

    expect(placeNewNodes(previous, current, []).get('root')).toEqual({ x: 999, y: 42 });
  });
});
