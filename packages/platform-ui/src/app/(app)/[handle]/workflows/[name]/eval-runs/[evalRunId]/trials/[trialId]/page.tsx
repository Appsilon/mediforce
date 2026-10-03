'use client';

import { useParams } from 'next/navigation';
import { EvalTrialDetail } from '@/components/evaluation/eval-trial-detail';

export default function EvalTrialPage() {
  const { handle, name, evalRunId, trialId } = useParams<{ handle: string; name: string; evalRunId: string; trialId: string }>();
  return <EvalTrialDetail handle={handle} workflowName={decodeURIComponent(name)} evalRunId={evalRunId} trialId={trialId} />;
}
