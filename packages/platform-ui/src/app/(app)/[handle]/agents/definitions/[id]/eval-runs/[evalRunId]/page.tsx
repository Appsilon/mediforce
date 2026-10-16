'use client';

import { useParams } from 'next/navigation';
import { EvalRunDetail } from '@/components/evaluation/eval-run-detail';
import { useAgentEvaluationGates } from '@/hooks/use-evaluation-gates';

/** An Eval Run of an Agent evaluated on its own (ADR-0029). */
export default function AgentEvalRunPage() {
  const { handle, id, evalRunId } = useParams<{ handle: string; id: string; evalRunId: string }>();
  const gates = useAgentEvaluationGates(handle, id);
  return <EvalRunDetail handle={handle} evalRunId={evalRunId} gates={gates} />;
}
