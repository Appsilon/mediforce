'use client';

import { useParams } from 'next/navigation';
import { EvalRunDetail } from '@/components/evaluation/eval-run-detail';
import { useWorkflowEvaluationGates } from '@/hooks/use-evaluation-gates';

export default function EvalRunPage() {
  const { handle, name, evalRunId } = useParams<{ handle: string; name: string; evalRunId: string }>();
  const gates = useWorkflowEvaluationGates(handle, decodeURIComponent(name));
  return <EvalRunDetail handle={handle} evalRunId={evalRunId} gates={gates} />;
}
