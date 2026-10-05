'use client';

import { useParams } from 'next/navigation';
import { EvalRunDetail } from '@/components/evaluation/eval-run-detail';

export default function EvalRunPage() {
  const { handle, name, evalRunId } = useParams<{ handle: string; name: string; evalRunId: string }>();
  return <EvalRunDetail handle={handle} workflowName={decodeURIComponent(name)} evalRunId={evalRunId} />;
}
