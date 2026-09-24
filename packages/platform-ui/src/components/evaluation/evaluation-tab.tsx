'use client';

import * as React from 'react';
import type { EvaluatedStep, WorkflowStep } from '@mediforce/platform-core';
import { useStepEvaluation } from '@/hooks/use-step-evaluation';
import { useWorkflowRunGate } from '@/hooks/use-workflow-access';
import { EvaluationAssistantPanel } from './evaluation-assistant-panel';
import {
  BriefSection,
  CasesSection,
  EvalRunsSection,
  EvaluatorsSection,
  McpPolicySection,
} from './step-evaluation-sections';

function StepEvaluation({ step, mayEdit, editReason, mayRun, runReason }: {
  step: EvaluatedStep;
  mayEdit: boolean;
  editReason: string | undefined;
  mayRun: boolean;
  runReason: string | undefined;
}) {
  const evaluation = useStepEvaluation(step);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <BriefSection step={step} data={evaluation.brief} mayEdit={mayEdit} />
        <EvaluatorsSection step={step} data={evaluation.evaluators} mayEdit={mayEdit} />
        <CasesSection step={step} evaluation={evaluation} mayEdit={mayEdit} />
        <McpPolicySection step={step} data={evaluation.mcpPolicy} mayEdit={mayEdit} />
        <EvalRunsSection step={step} data={evaluation.runs} mayRun={mayRun} runReason={runReason} />
      </div>
      <EvaluationAssistantPanel step={step} mayEdit={mayEdit} editReason={editReason} mayRun={mayRun} runReason={runReason} />
    </div>
  );
}

/**
 * The workflow's **Evaluation** tab (ADR-0023 D14): one agent step at a time,
 * its Brief, Evaluators, Eval Cases, MCP eval policy and Eval Runs beside the
 * Evaluation Assistant. Everything here lives outside the definition, so no
 * change on this tab mints a version.
 */
export function EvaluationTab({ handle, workflowName, steps, mayEdit, editReason }: {
  handle: string;
  workflowName: string;
  steps: readonly WorkflowStep[];
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const agentSteps = steps.filter((step) => step.executor === 'agent');
  const { mayRun, reason: runReason } = useWorkflowRunGate(handle, workflowName);
  const [stepId, setStepId] = React.useState<string | null>(null);
  const selected = agentSteps.find((step) => step.id === stepId) ?? agentSteps[0];

  if (selected === undefined) {
    return <p className="text-sm text-muted-foreground">This workflow has no agent steps to evaluate.</p>;
  }
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Step</span>
        <select
          data-testid="evaluation-step-select"
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={selected.id}
          onChange={(event) => setStepId(event.target.value)}
        >
          {agentSteps.map((step) => <option key={step.id} value={step.id}>{step.name}</option>)}
        </select>
      </label>
      <StepEvaluation key={selected.id} step={{ namespace: handle, workflowName, stepId: selected.id }} mayEdit={mayEdit} editReason={editReason} mayRun={mayRun} runReason={runReason} />
    </div>
  );
}
