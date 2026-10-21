'use client';

import * as React from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { StepExecution, WorkflowDefinition } from '@mediforce/platform-core';
import { WorkflowDiagram, graphEdgesOf, type DiagramReplayFrame } from '@/components/workflows/workflow-diagram';
import {
  buildReplayHops,
  firstReplayStep,
  replayDwellsMs,
  REPLAY_TRAVEL_MS,
  type ReplayPacing,
} from '@/components/workflows/run-replay';
import { secondaryButtonClass } from '@/components/ui/button-styles';
import { cn } from '@/lib/utils';

const SPEEDS = [1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];

/** A jump between steps the diagram draws no arrow for is a short blink, not a ride. */
const JUMP_MS = 150;

/** Where the replay stands: `hopsDone` hops are finished, and the ball is either
 *  waiting at its step or riding the next hop. null = at the end of the run. */
type Cursor = { hopsDone: number; phase: 'dwell' | 'travel' } | null;

export function RunReplayDiagram({
  definition,
  stepExecutions,
  className,
}: {
  definition: WorkflowDefinition;
  stepExecutions: StepExecution[];
  className?: string;
}) {
  const edgeIds = React.useMemo(
    () => new Set(graphEdgesOf(definition).map((edge) => `${edge.from}->${edge.to}`)),
    [definition],
  );
  const hops = React.useMemo(() => buildReplayHops(stepExecutions, edgeIds), [stepExecutions, edgeIds]);
  const firstStepId = React.useMemo(() => firstReplayStep(stepExecutions), [stepExecutions]);

  const [pacing, setPacing] = React.useState<ReplayPacing>('proportional');
  const [speed, setSpeed] = React.useState<Speed>(1);
  const [playing, setPlaying] = React.useState(false);
  // Opens at the end: the diagram shows the whole path the run took before anyone presses play.
  const [cursor, setCursor] = React.useState<Cursor>(null);

  const dwells = React.useMemo(() => replayDwellsMs(hops, pacing), [hops, pacing]);
  const hopsDone = cursor === null ? hops.length : cursor.hopsDone;
  const travelling = cursor !== null && cursor.phase === 'travel';
  const currentHop = travelling ? hops[hopsDone] : undefined;

  React.useEffect(() => {
    if (playing === false || cursor === null) return;
    if (cursor.hopsDone >= hops.length) {
      setPlaying(false);
      setCursor(null);
      return;
    }
    const hop = hops[cursor.hopsDone];
    const durationMs =
      cursor.phase === 'dwell'
        ? dwells[cursor.hopsDone]
        : hop.edgeId === null ? JUMP_MS : REPLAY_TRAVEL_MS;
    const timer = setTimeout(() => {
      setCursor(
        cursor.phase === 'dwell'
          ? { hopsDone: cursor.hopsDone, phase: 'travel' }
          : { hopsDone: cursor.hopsDone + 1, phase: 'dwell' },
      );
    }, durationMs / speed);
    return () => clearTimeout(timer);
  }, [playing, cursor, hops, dwells, speed]);

  const frame = React.useMemo<DiagramReplayFrame>(() => {
    const edgeTraversals = new Map<string, number>();
    const ridden = currentHop ? hops.slice(0, hopsDone + 1) : hops.slice(0, hopsDone);
    for (const hop of ridden) {
      if (hop.edgeId !== null) edgeTraversals.set(hop.edgeId, (edgeTraversals.get(hop.edgeId) ?? 0) + 1);
    }
    const activeStepId = currentHop ? null : hopsDone === 0 ? firstStepId : hops[hopsDone - 1].to;
    const travel = currentHop?.edgeId
      ? { edgeId: currentHop.edgeId, key: hopsDone, durationMs: REPLAY_TRAVEL_MS / speed }
      : null;
    const followStepId = playing ? currentHop?.to ?? activeStepId : null;
    return { activeStepId, travel, edgeTraversals, followStepId };
  }, [hops, hopsDone, currentHop, firstStepId, speed, playing]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (cursor === null) setCursor({ hopsDone: 0, phase: 'dwell' });
    setPlaying(true);
  };

  const restart = () => {
    setCursor({ hopsDone: 0, phase: 'dwell' });
    setPlaying(true);
  };

  const stepNames = React.useMemo(
    () => new Map(definition.steps.map((step) => [step.id, step.name])),
    [definition],
  );
  const stepLabel = frame.activeStepId !== null ? stepNames.get(frame.activeStepId) ?? frame.activeStepId : null;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {hops.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="run-replay-controls">
          <button type="button" className={secondaryButtonClass} onClick={togglePlay}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {playing ? 'Pause' : 'Replay run'}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={restart} aria-label="Restart replay">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <SegmentedControl
            label="Pacing"
            value={pacing}
            options={[
              { value: 'proportional', label: 'Proportional', title: 'Wait at each step in proportion to the time the run spent there' },
              { value: 'journey', label: 'Path only', title: 'Same short beat at every step — just the path the run took' },
            ]}
            onChange={setPacing}
          />
          <SegmentedControl
            label="Speed"
            value={speed}
            options={SPEEDS.map((value) => ({ value, label: `${value}×` }))}
            onChange={setSpeed}
          />
          <span className="text-xs text-muted-foreground tabular-nums" data-testid="run-replay-position">
            Hop {hopsDone + (currentHop ? 1 : 0)} of {hops.length}
            {stepLabel !== null && <> · {stepLabel}</>}
          </span>
        </div>
      )}
      <WorkflowDiagram definition={definition} className="w-full" replay={frame} />
    </div>
  );
}

function SegmentedControl<Value extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: Array<{ value: Value; label: string; title?: string }>;
  onChange: (value: Value) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded px-2 py-1 text-xs font-medium transition-colors',
            option.value === value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
