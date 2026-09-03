import { describe, it, expect } from 'vitest';
import { computeGraphLayout, NODE_WIDTH, COLUMN_GAP } from '../workflow-graph-layout';

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
