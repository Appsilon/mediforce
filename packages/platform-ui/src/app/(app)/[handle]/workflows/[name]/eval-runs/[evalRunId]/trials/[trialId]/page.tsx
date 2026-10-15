'use client';

import { useParams } from 'next/navigation';
import { EvalTrialDetail } from '@/components/evaluation/eval-trial-detail';
import { useWorkflowEvaluationGates } from '@/hooks/use-evaluation-gates';

export default function EvalTrialPage() {
  const { handle, name, evalRunId, trialId } = useParams<{ handle: string; name: string; evalRunId: string; trialId: string }>();
  const gates = useWorkflowEvaluationGates(handle, decodeURIComponent(name));
  return <EvalTrialDetail handle={handle} evalRunId={evalRunId} trialId={trialId} gates={gates} />;
}
