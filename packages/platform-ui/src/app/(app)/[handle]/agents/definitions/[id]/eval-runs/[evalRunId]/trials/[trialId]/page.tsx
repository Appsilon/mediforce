'use client';

import { useParams } from 'next/navigation';
import { EvalTrialDetail } from '@/components/evaluation/eval-trial-detail';
import { useAgentEvaluationGates } from '@/hooks/use-evaluation-gates';

/** One trial of an Agent's Eval Run (ADR-0029). */
export default function AgentEvalTrialPage() {
  const { handle, id, evalRunId, trialId } = useParams<{ handle: string; id: string; evalRunId: string; trialId: string }>();
  const gates = useAgentEvaluationGates(handle, id);
  return <EvalTrialDetail handle={handle} evalRunId={evalRunId} trialId={trialId} gates={gates} />;
}
