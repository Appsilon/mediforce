import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import sharp from 'sharp';
import type { OutputSink } from '../output.js';

interface Step {
  id: string;
  name: string;
  type?: string;
  executor?: string;
  autonomyLevel?: string;
  verdicts?: Record<string, { target: string }>;
}

interface Transition {
  from: string;
  to: string;
  label?: string;
}

interface WorkflowInput {
  name?: string;
  steps: Step[];
  transitions: Transition[];
}

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const TYPE_COLORS: Record<string, string> = {
  creation: '#0ea5e9',
  review: '#f59e0b',
  decision: '#a855f7',
  terminal: '#10b981',
};

const EXECUTOR_COLORS: Record<string, string> = {
  human: '#2563eb',
  agent: '#7c3aed',
  script: '#b45309',
  cowork: '#0d9488',
  action: '#dc2626',
};

const DEFAULT_COLOR = '#64748b';

const NODE_W = 300;
const NODE_H = 88;
const H_GAP = 60;
const V_GAP = 100;
const PADDING = 80;

const HELP = `Usage: mediforce diagram --file <path> [--output <file>]

Generate a PNG diagram from a workflow YAML definition.

Required flags:
  --file <path>      Path to the workflow YAML file

Optional flags:
  --output <file>    Output PNG filename (default: <input-stem>.png)
  --help, -h         Show this help text

Accepts both full Mediforce workflow definitions and simplified YAML
with only steps and transitions/edges.
`;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function parseWorkflow(raw: unknown): WorkflowInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Workflow YAML must be an object');
  }

  const obj = raw as Record<string, unknown>;

  const name = typeof obj['name'] === 'string' ? obj['name'] : undefined;

  const rawSteps = Array.isArray(obj['steps']) ? obj['steps'] : [];
  const steps: Step[] = rawSteps.map((s: unknown) => {
    if (typeof s !== 'object' || s === null || Array.isArray(s)) {
      throw new Error('Each step must be an object');
    }
    const step = s as Record<string, unknown>;
    const verdicts: Record<string, { target: string }> | undefined =
      typeof step['verdicts'] === 'object' && step['verdicts'] !== null && !Array.isArray(step['verdicts'])
        ? Object.fromEntries(
            Object.entries(step['verdicts'] as Record<string, unknown>).map(([k, v]) => {
              if (typeof v !== 'object' || v === null || Array.isArray(v)) {
                throw new Error(`Verdict "${k}" must be an object`);
              }
              const vObj = v as Record<string, unknown>;
              return [k, { target: String(vObj['target'] ?? '') }];
            }),
          )
        : undefined;

    return {
      id: String(step['id'] ?? ''),
      name: String(step['name'] ?? ''),
      type: typeof step['type'] === 'string' ? step['type'] : undefined,
      executor: typeof step['executor'] === 'string' ? step['executor'] : undefined,
      autonomyLevel: typeof step['autonomyLevel'] === 'string' ? step['autonomyLevel'] : undefined,
      verdicts,
    };
  });

  const rawTransitionsSource = Array.isArray(obj['transitions'])
    ? obj['transitions']
    : Array.isArray(obj['edges'])
      ? obj['edges']
      : [];

  const explicitTransitions: Transition[] = rawTransitionsSource.map((t: unknown) => {
    if (typeof t !== 'object' || t === null || Array.isArray(t)) {
      throw new Error('Each transition must be an object');
    }
    const tr = t as Record<string, unknown>;
    return {
      from: String(tr['from'] ?? ''),
      to: String(tr['to'] ?? ''),
      label: typeof tr['label'] === 'string' ? tr['label'] : undefined,
    };
  });

  const verdictTransitions: Transition[] = [];
  for (const step of steps) {
    if (step.verdicts !== undefined) {
      for (const [verdictName, verdict] of Object.entries(step.verdicts)) {
        verdictTransitions.push({ from: step.id, to: verdict.target, label: verdictName });
      }
    }
  }

  const transitions = [...verdictTransitions, ...explicitTransitions];

  return { name, steps, transitions };
}

function computeLayout(steps: Step[], transitions: Transition[]): Map<string, { x: number; y: number }> {
  const stepIds = new Set(steps.map((s) => s.id));
  const outEdges = new Map<string, string[]>();

  for (const step of steps) outEdges.set(step.id, []);
  for (const t of transitions) {
    if (stepIds.has(t.from) && stepIds.has(t.to)) outEdges.get(t.from)!.push(t.to);
  }

  // Identify back-edges via iterative DFS so cycles don't break layer assignment.
  const backEdges = new Set<string>();
  const visited = new Set<string>();
  const onStack = new Set<string>();
  for (const startId of steps.map((s) => s.id)) {
    if (visited.has(startId)) continue;
    const stack: Array<{ id: string; ni: number }> = [{ id: startId, ni: 0 }];
    visited.add(startId);
    onStack.add(startId);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbors = outEdges.get(frame.id) ?? [];
      if (frame.ni >= neighbors.length) {
        onStack.delete(frame.id);
        stack.pop();
        continue;
      }
      const neighbor = neighbors[frame.ni++]!;
      if (onStack.has(neighbor)) {
        backEdges.add(`${frame.id}->${neighbor}`);
      } else if (!visited.has(neighbor)) {
        visited.add(neighbor);
        onStack.add(neighbor);
        stack.push({ id: neighbor, ni: 0 });
      }
    }
  }

  // Build inDegree using only forward edges (excluding back-edges).
  const inDegree = new Map<string, number>(steps.map((s) => [s.id, 0]));
  for (const t of transitions) {
    if (!stepIds.has(t.from) || !stepIds.has(t.to)) continue;
    if (backEdges.has(`${t.from}->${t.to}`)) continue;
    inDegree.set(t.to, (inDegree.get(t.to) ?? 0) + 1);
  }

  // BFS longest-path layering on the forward-edge DAG only.
  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const step of steps) {
    if ((inDegree.get(step.id) ?? 0) === 0) {
      layer.set(step.id, 0);
      queue.push(step.id);
    }
  }
  if (queue.length === 0 && steps.length > 0) {
    layer.set(steps[0]!.id, 0);
    queue.push(steps[0]!.id);
  }

  const layerAssigned = new Set<string>(queue);
  let qi = 0;
  while (qi < queue.length) {
    const nodeId = queue[qi++]!;
    const currentLayer = layer.get(nodeId) ?? 0;
    for (const neighbor of outEdges.get(nodeId) ?? []) {
      if (backEdges.has(`${nodeId}->${neighbor}`)) continue;
      const next = currentLayer + 1;
      if (!layerAssigned.has(neighbor) || next > (layer.get(neighbor) ?? 0)) {
        layer.set(neighbor, next);
        layerAssigned.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  for (const step of steps) {
    if (!layer.has(step.id)) layer.set(step.id, 0);
  }

  const layerGroups = new Map<number, string[]>();
  for (const [id, l] of layer.entries()) {
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l)!.push(id);
  }

  const sortedLayers = [...layerGroups.entries()].sort(([a], [b]) => a - b);
  const maxNodesInLayer = Math.max(...sortedLayers.map(([, nodes]) => nodes.length));
  const canvasWidth = PADDING * 2 + maxNodesInLayer * NODE_W + (maxNodesInLayer - 1) * H_GAP;

  const positions = new Map<string, { x: number; y: number }>();

  for (let layerIdx = 0; layerIdx < sortedLayers.length; layerIdx++) {
    const [, nodes] = sortedLayers[layerIdx]!;
    const n = nodes.length;
    const rowWidth = n * NODE_W + (n - 1) * H_GAP;
    const xStart = (canvasWidth - rowWidth) / 2;
    for (let i = 0; i < n; i++) {
      const nodeId = nodes[i]!;
      positions.set(nodeId, {
        x: xStart + i * (NODE_W + H_GAP),
        y: PADDING + layerIdx * (NODE_H + V_GAP),
      });
    }
  }

  return positions;
}

function generateSvg(
  steps: Step[],
  transitions: Transition[],
  positions: Map<string, { x: number; y: number }>,
  workflowName?: string,
): string {
  const titleH = workflowName !== undefined ? 60 : 0;
  const footerH = 30;

  let maxX = 0;
  let maxY = 0;
  for (const pos of positions.values()) {
    if (pos.x + NODE_W + PADDING > maxX) maxX = pos.x + NODE_W + PADDING;
    if (pos.y + NODE_H + PADDING > maxY) maxY = pos.y + NODE_H + PADDING;
  }

  const svgW = maxX;
  const svgH = maxY + titleH + footerH;
  const finalW = Math.max(svgW, 1200);
  const finalH = Math.round(svgH * finalW / svgW);

  const seenEdges = new Map<string, Transition>();
  for (const t of transitions) {
    const key = `${t.from}→${t.to}`;
    if (!seenEdges.has(key) || (t.label !== undefined && seenEdges.get(key)!.label === undefined)) {
      seenEdges.set(key, t);
    }
  }

  const layerOf = (nodeId: string): number => {
    const pos = positions.get(nodeId);
    if (pos === undefined) return 0;
    return Math.round(pos.y / (NODE_H + V_GAP));
  };

  const edgeSvg: string[] = [];
  for (const t of seenEdges.values()) {
    const fromPos = positions.get(t.from);
    const toPos = positions.get(t.to);
    if (fromPos === undefined || toPos === undefined) continue;

    const x1 = fromPos.x + NODE_W / 2;
    const y1 = fromPos.y + NODE_H + titleH;
    const x2 = toPos.x + NODE_W / 2;
    const y2 = toPos.y + titleH;

    const isBack = layerOf(t.to) <= layerOf(t.from);

    let pathD: string;
    let stroke: string;
    let dashArray: string;
    let markerEnd: string;

    if (isBack) {
      const bend = Math.max(x1, x2) + 60;
      pathD = `M ${x1},${y1} C ${bend},${y1} ${bend},${y2} ${x2},${y2}`;
      stroke = '#f59e0b';
      dashArray = '6 4';
      markerEnd = 'url(#arrowBack)';
    } else {
      const midY = (y1 + y2) / 2;
      pathD = `M ${x1},${y1} C ${x1},${midY} ${x2},${midY} ${x2},${y2}`;
      stroke = '#94a3b8';
      dashArray = '';
      markerEnd = 'url(#arrow)';
    }

    const dashAttr = dashArray.length > 0 ? ` stroke-dasharray="${dashArray}"` : '';
    edgeSvg.push(
      `<path d="${escapeXml(pathD)}" fill="none" stroke="${stroke}" stroke-width="2" marker-end="${markerEnd}"${dashAttr}/>`,
    );

    if (t.label !== undefined) {
      const cx = isBack
        ? ((x1 + x2) / 2) + 50
        : (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const labelText = escapeXml(t.label);
      const labelW = t.label.length * 7 + 16;
      edgeSvg.push(
        `<rect x="${cx - labelW / 2}" y="${cy - 9}" width="${labelW}" height="18" rx="4" fill="white" stroke="${stroke}" stroke-width="1"/>`,
        `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="10" font-family="Arial,Helvetica,sans-serif" fill="${stroke}">${labelText}</text>`,
      );
    }
  }

  const nodeSvg: string[] = [];
  for (const step of steps) {
    const pos = positions.get(step.id);
    if (pos === undefined) continue;

    const nx = pos.x;
    const ny = pos.y + titleH;
    const typeColor = (step.type !== undefined && TYPE_COLORS[step.type] !== undefined)
      ? TYPE_COLORS[step.type]!
      : DEFAULT_COLOR;

    const safeId = escapeXml(step.id);
    const clipId = `c${safeId}`;

    nodeSvg.push(`<g>`);
    nodeSvg.push(
      `<rect x="${nx}" y="${ny}" width="${NODE_W}" height="${NODE_H}" rx="10" fill="white" filter="url(#shadow)" stroke="#e2e8f0" stroke-width="1"/>`,
    );
    nodeSvg.push(`<clipPath id="${clipId}"><rect x="${nx}" y="${ny}" width="${NODE_W}" height="${NODE_H}" rx="10"/></clipPath>`);
    nodeSvg.push(
      `<rect x="${nx}" y="${ny}" width="6" height="${NODE_H}" fill="${typeColor}" clip-path="url(#${clipId})"/>`,
    );
    nodeSvg.push(
      `<text x="${nx + 22}" y="${ny + 33}" font-size="17" font-weight="700" font-family="Arial,Helvetica,sans-serif" fill="#1e293b">${escapeXml(truncate(step.name, 26))}</text>`,
    );

    const badges: Array<{ label: string; color: string }> = [];
    if (step.type !== undefined) {
      badges.push({ label: step.type, color: typeColor });
    }
    if (step.executor !== undefined) {
      const exColor = EXECUTOR_COLORS[step.executor] ?? DEFAULT_COLOR;
      badges.push({ label: step.executor, color: exColor });
    }
    if (step.autonomyLevel !== undefined) {
      badges.push({ label: step.autonomyLevel, color: DEFAULT_COLOR });
    }

    let badgeX = nx + 22;
    const badgeY = ny + 60;
    for (const badge of badges) {
      const bw = badge.label.length * 7 + 16;
      nodeSvg.push(
        `<rect x="${badgeX}" y="${badgeY - 9}" width="${bw}" height="18" rx="4" fill="${badge.color}" fill-opacity="0.15"/>`,
        `<text x="${badgeX + bw / 2}" y="${badgeY}" text-anchor="middle" dominant-baseline="middle" font-size="10" font-weight="600" font-family="Arial,Helvetica,sans-serif" fill="${badge.color}">${escapeXml(badge.label)}</text>`,
      );
      badgeX += bw + 6;
    }

    nodeSvg.push(`</g>`);
  }

  const titleSvg =
    workflowName !== undefined
      ? `<text x="${svgW / 2}" y="36" text-anchor="middle" font-size="24" font-weight="700" font-family="Arial,Helvetica,sans-serif" fill="#1e293b">${escapeXml(workflowName)}</text>`
      : '';

  const brandingX = svgW - PADDING / 2;
  const brandingY = svgH - 10;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${finalW}" height="${finalH}" viewBox="0 0 ${svgW} ${svgH}">`,
    `<defs>`,
    `<filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">`,
    `<feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.08"/>`,
    `</filter>`,
    `<marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">`,
    `<path d="M0,0 L0,8 L8,4 z" fill="#94a3b8"/>`,
    `</marker>`,
    `<marker id="arrowBack" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">`,
    `<path d="M0,0 L0,8 L8,4 z" fill="#f59e0b"/>`,
    `</marker>`,
    `</defs>`,
    `<rect fill="#f8fafc" width="${svgW}" height="${svgH}"/>`,
    titleSvg,
    ...edgeSvg,
    ...nodeSvg,
    `<text x="${brandingX}" y="${brandingY}" text-anchor="end" font-size="10" font-family="Arial,Helvetica,sans-serif" fill="#94a3b8">Mediforce</text>`,
    `</svg>`,
  ].join('\n');
}

const DIAGRAM_OPTIONS = {
  file: { type: 'string' },
  output: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

export async function diagramCommand(input: CommandInput): Promise<number> {
  let flags: { file?: string; output?: string; help?: boolean };

  try {
    const parsed = parseArgs({
      args: input.argv,
      options: DIAGRAM_OPTIONS,
      strict: true,
      allowPositionals: false,
    });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce diagram: ${String(err)}`);
    input.output.stderr('');
    input.output.stderr(HELP);
    return 2;
  }

  if (flags.help === true || flags.file === undefined) {
    input.output.stdout(HELP);
    return flags.file === undefined && flags.help !== true ? 2 : 0;
  }

  let raw: string;
  try {
    raw = await readFile(flags.file, 'utf-8');
  } catch (err) {
    input.output.stderr(`Error: Failed to read file: ${flags.file} — ${String(err)}`);
    return 1;
  }

  let workflow: WorkflowInput;
  try {
    const parsed = parseYaml(raw);
    workflow = parseWorkflow(parsed);
  } catch (err) {
    input.output.stderr(`Error: Failed to parse workflow: ${String(err)}`);
    return 1;
  }

  if (workflow.steps.length === 0) {
    input.output.stderr('Error: Workflow has no steps');
    return 1;
  }

  const positions = computeLayout(workflow.steps, workflow.transitions);
  const svg = generateSvg(workflow.steps, workflow.transitions, positions, workflow.name);

  const stem = path.basename(flags.file, path.extname(flags.file));
  const outputPath = flags.output ?? `${stem}.png`;

  try {
    await sharp(Buffer.from(svg)).png().toFile(outputPath);
  } catch (err) {
    input.output.stderr(`Error: Failed to write PNG: ${String(err)}`);
    return 1;
  }

  input.output.stdout(`Diagram saved to ${outputPath} (${String(workflow.steps.length)} steps)`);
  return 0;
}
