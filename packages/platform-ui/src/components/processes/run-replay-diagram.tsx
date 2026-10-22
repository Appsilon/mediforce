'use client';

import * as React from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { ProcessInstance, StepExecution, WorkflowDefinition } from '@mediforce/platform-core';
import { WorkflowDiagram, graphEdgesOf, type DiagramReplayFrame } from '@/components/workflows/workflow-diagram';
import { edgeIdOf } from '@/components/workflows/workflow-graph-layout';
import {
  buildReplayPath,
  replayDwellsMs,
  REPLAY_TRAVEL_MS,
  type ReplayPacing,
} from '@/components/workflows/run-replay';
import { secondaryButtonClass } from '@/components/ui/button-styles';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/utils';
import { useChildRunExpansion } from '@/hooks/use-child-workflows';

const SPEEDS = [1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];

/** A jump between steps the diagram draws no arrow for is a short blink, not a ride. */
const JUMP_MS = 150;

/** Where the replay stands: `hopsDone` hops are finished, and the ball is either
 *  waiting at its step or riding the next hop. null = at the end of the run. */
type Cursor = { hopsDone: number; phase: 'dwell' | 'travel' } | null;

export function RunReplayDiagram({
  definition,
  run,
  stepExecutions,
  className,
}: {
  definition: WorkflowDefinition;
  run: Pick<ProcessInstance, 'id' | 'status' | 'namespace'>;
  stepExecutions: StepExecution[];
  className?: string;
}) {
  // A completed run also rides the arrow into the terminal step it reached.
  const completed = run.status === 'completed';
  const childWorkflows = useChildRunExpansion(definition, run);
  const edgeIds = React.useMemo(
    () => new Set(graphEdgesOf(definition).map((edge) => edgeIdOf(edge.from, edge.to))),
    [definition],
  );
  const terminalStepIds = React.useMemo(
    () => completed === true
      ? new Set(definition.steps.filter((step) => step.type === 'terminal').map((step) => step.id))
      : null,
    [definition, completed],
  );
  const { firstStepId, hops } = React.useMemo(
    () => buildReplayPath(stepExecutions, edgeIds, terminalStepIds),
    [stepExecutions, edgeIds, terminalStepIds],
  );

  const [pacing, setPacing] = React.useState<ReplayPacing>('proportional');
  const [speed, setSpeed] = React.useState<Speed>(1);
  const [playing, setPlaying] = React.useState(false);
  // Opens at the end: the diagram shows the whole path the run took before anyone presses play.
  const [cursor, setCursor] = React.useState<Cursor>(null);

  const dwells = React.useMemo(() => replayDwellsMs(hops, pacing), [hops, pacing]);
  const hopsDone = cursor === null ? hops.length : cursor.hopsDone;
  const travelling = cursor !== null && cursor.phase === 'travel';
  const currentHop = travelling ? hops[hopsDone] : undefined;
  // Share of the cursor's phase already played, so resuming after a pause continues it.
  const playedRef = React.useRef<{ cursor: Cursor; share: number }>({ cursor: null, share: 0 });

  React.useEffect(() => {
    if (cursor === null || playing === false) return;
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
    const phaseMs = durationMs / speed;
    const playedShare = playedRef.current.cursor === cursor ? playedRef.current.share : 0;
    const resumedAt = Date.now();
    let finished = false;
    const timer = setTimeout(() => {
      finished = true;
      setCursor(
        cursor.phase === 'dwell'
          ? { hopsDone: cursor.hopsDone, phase: 'travel' }
          : { hopsDone: cursor.hopsDone + 1, phase: 'dwell' },
      );
    }, phaseMs * (1 - playedShare));
    return () => {
      clearTimeout(timer);
      if (finished === false) {
        playedRef.current = { cursor, share: Math.min(1, playedShare + (Date.now() - resumedAt) / phaseMs) };
      }
    };
  }, [playing, cursor, hops, dwells, speed]);

  // Kept apart from the frame: a new travel object restarts the ball's ride, so
  // toggling play/pause must not rebuild it — the frame's `paused` freezes it instead.
  const travel = React.useMemo<DiagramReplayFrame['travel']>(
    () =>
      currentHop !== undefined && currentHop.edgeId !== null
        ? { edgeId: currentHop.edgeId, key: hopsDone, durationMs: REPLAY_TRAVEL_MS / speed }
        : null,
    [currentHop, hopsDone, speed],
  );

  const frame = React.useMemo<DiagramReplayFrame>(() => {
    const edgeTraversals = new Map<string, number>();
    const ridden = currentHop !== undefined ? hops.slice(0, hopsDone + 1) : hops.slice(0, hopsDone);
    for (const hop of ridden) {
      if (hop.edgeId !== null) edgeTraversals.set(hop.edgeId, (edgeTraversals.get(hop.edgeId) ?? 0) + 1);
    }
    const activeStepId = currentHop !== undefined ? null : hopsDone === 0 ? firstStepId : hops[hopsDone - 1].to;
    const followStepId = playing === true ? currentHop?.to ?? activeStepId : null;
    return { activeStepId, travel, paused: playing === false, edgeTraversals, followStepId };
  }, [hops, hopsDone, currentHop, firstStepId, travel, playing]);

  const togglePlay = () => {
    if (playing === true) {
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
            {playing === true ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {playing === true ? 'Pause' : 'Replay run'}
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
            Hop {hopsDone + (currentHop !== undefined ? 1 : 0)} of {hops.length}
            {stepLabel !== null && <> · {stepLabel}</>}
          </span>
        </div>
      )}
      {/* Fills the space it is given, so the whole run is on screen at once instead of a canvas taller than the panel. */}
      <div className="flex-1 min-h-0">
        <WorkflowDiagram definition={definition} className="w-full" style={{ height: '100%' }} replay={frame} childWorkflows={childWorkflows} />
      </div>
    </div>
  );
}
