import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  DEFAULT_ACCEPTANCE_CRITERIA,
  agentStepChanges,
  inlineMcpServerNames,
  qualificationOutcome,
  qualificationSignatureMeaning,
  type AcceptanceCriteria,
  type AgentDefinition,
  type ElectronicSignature,
  type EvalRun,
  type EvaluationSubject,
  type EvalRunEvaluator,
  type StepFingerprint,
  type StepQualification,
  type WorkflowDefinition,
  type WorkflowStep,
  describeEvaluationSubject,
  evaluationOwnerOf,
} from '@mediforce/platform-core';
import type {
  GetStepQualificationInputSchema,
  GetStepQualificationOutput,
  GetWorkflowValidationInputSchema,
  GetWorkflowValidationOutput,
  ListAgentValidationsInputSchema,
  ListAgentValidationsOutput,
  SignStepQualificationInputSchema,
  SignStepQualificationOutput,
  StepValidation,
  WorkflowVersionValidation,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { ConflictError, ForbiddenError, NotFoundError, PreconditionFailedError, ValidationError } from '../../errors';
import { inlineMcpReason, loadEvaluationSubject, subjectName, subjectRef, runVersionOf } from './_lib/evaluation-subject';
import { appendEvaluationAudit } from './_lib/audit';
import { currentAgentVersion } from '../agents/_lib/agent-version';
import { buildEvalRunReport, rebuildEvalRunAcceptance } from './_lib/eval-run-report';
import { changedFingerprintComponents, computeStepFingerprint } from './_lib/step-fingerprint';

/** One of the Step's Evaluators with its newest version — `null` once archived. */
interface StepEvaluator {
  readonly id: string;
  readonly name: string;
  readonly latestVersion: number | null;
}

/**
 * The Step's own Evaluation rows — the same in every Definition version — each
 * read at most once, however many versions' validations ask for it.
 */
interface SubjectRows {
  readonly runs: () => Promise<readonly EvalRun[]>;
  readonly evaluators: () => Promise<readonly StepEvaluator[]>;
  readonly liveCaseIds: () => Promise<readonly string[]>;
  readonly criteria: () => Promise<AcceptanceCriteria>;
  readonly qualifications: () => Promise<readonly StepQualification[]>;
}

function once<Value>(read: () => Promise<Value>): () => Promise<Value> {
  let pending: Promise<Value> | undefined;
  return () => (pending ??= read());
}

function subjectRows(scope: CallerScope, step: EvaluationSubject): SubjectRows {
  return {
    runs: once(() => scope.evaluation.listEvalRuns(step)),
    evaluators: once(async () => Promise.all((await scope.evaluation.listEvaluators(step)).map(async (evaluator) => ({
      id: evaluator.id,
      name: evaluator.name,
      latestVersion: evaluator.archived === true ? null : (await scope.evaluation.listEvaluatorVersions(evaluator.id)).at(-1)!.version,
    })))),
    liveCaseIds: once(async () => (await scope.evaluation.listCases(step)).filter((evalCase) => evalCase.archived === false).map((evalCase) => evalCase.id)),
    criteria: once(async () => (await scope.evaluation.listAcceptanceCriteria(step))[0]?.criteria ?? DEFAULT_ACCEPTANCE_CRITERIA),
    qualifications: once(() => scope.evaluation.listQualifications(step)),
  };
}

/** What happened to the Step's Evaluators since a qualification or an Eval Run froze them (D7). */
function evaluatorChanges(evaluators: readonly StepEvaluator[], frozen: readonly EvalRunEvaluator[], frozenBy: string): string[] {
  const cited = new Map(frozen.map((evaluator) => [evaluator.evaluatorId, evaluator.version]));
  const changes: string[] = [];
  for (const evaluator of evaluators) {
    const citedVersion = cited.get(evaluator.id);
    if (evaluator.latestVersion === null) {
      if (citedVersion !== undefined) changes.push(`'${evaluator.name}' archived`);
      continue;
    }
    if (citedVersion === undefined) changes.push(`'${evaluator.name}' added`);
    else if (evaluator.latestVersion !== citedVersion) changes.push(`'${evaluator.name}' now v${evaluator.latestVersion}, ${frozenBy} v${citedVersion}`);
  }
  return changes;
}

const FINISHED_RUN_STATUSES = new Set(['completed', 'budget_exceeded']);

/**
 * Which Eval Runs a validation reads: those of one Definition version of a
 * Step, or of one Agent version (ADR-0029) — null when the Agent changed since
 * its newest version, so no run assessed it as it is.
 */
interface ValidatedVersion {
  readonly subject: 'step' | 'agent';
  readonly label: string;
  readonly ran: (run: EvalRun) => boolean;
}

function definitionVersionOf(definitionVersion: number): ValidatedVersion {
  return { subject: 'step', label: `version ${definitionVersion}`, ran: (run) => run.definitionVersion === definitionVersion };
}

/**
 * The step's validation in one Definition version — or an Agent's in its
 * current version: the newest finished Eval Run of that version, judged on the criteria frozen into it — reset to
 * `not_verified` by any change to what that run rested on. Its verdict stands
 * once a person signed that run (`confirmed` or `overwritten`); until then the
 * step is `awaiting_approval`. A step that declares
 * MCP servers inline cannot be evaluated, so it stays `not_verified`. Its
 * Fingerprint is computed only when a run of that version finished.
 */
async function stepValidation(
  scope: CallerScope,
  rows: SubjectRows,
  workflowStep: WorkflowStep,
  version: ValidatedVersion,
  stepFingerprint: () => Promise<StepFingerprint>,
): Promise<StepValidation> {
  const inlineServers = inlineMcpServerNames(workflowStep);
  if (inlineServers.length > 0) {
    return { status: 'not_verified', evalRunId: null, reason: `The step ${inlineMcpReason(inlineServers)}.`, runInProgress: false };
  }
  const runs = await rows.runs();
  const runInProgress = runs.some((run) => run.status === 'running');
  const run = runs.find((candidate) => version.ran(candidate) && FINISHED_RUN_STATUSES.has(candidate.status));
  if (run === undefined) {
    return { status: 'not_verified', evalRunId: null, reason: `No Eval Run of ${version.label} has finished yet.`, runInProgress };
  }
  const notVerified = (reason: string): StepValidation => ({ status: 'not_verified', evalRunId: run.id, reason, runInProgress });
  const since = `since Eval Run ${run.id.slice(0, 8)}`;
  const fingerprint = await stepFingerprint();

  if (run.fingerprint === null || run.fingerprint.hash !== fingerprint.hash) {
    const changed = (run.fingerprint === null ? [] : changedFingerprintComponents(run.fingerprint, fingerprint))
      .map((component) => (version.subject === 'agent' && component === 'step' ? 'trial env' : component));
    return notVerified(`The ${version.subject} changed ${since}${changed.length === 0 ? '' : `: ${changed.join(', ')}`}.`);
  }
  const evaluatorsChanged = evaluatorChanges(await rows.evaluators(), run.evaluators, 'run with');
  if (evaluatorsChanged.length > 0) return notVerified(`Evaluators changed ${since}: ${evaluatorsChanged.join('; ')}.`);
  const live = await rows.liveCaseIds();
  const ran = new Set(run.caseIds);
  if (live.length !== ran.size || live.some((caseId) => ran.has(caseId) === false)) {
    return notVerified(`Eval Cases were added, edited or archived ${since}.`);
  }
  if (run.acceptanceCriteria === null || JSON.stringify(await rows.criteria()) !== JSON.stringify(run.acceptanceCriteria)) {
    return notVerified(run.acceptanceCriteria === null ? `Eval Run ${run.id.slice(0, 8)} had no Acceptance Criteria to judge.` : `Acceptance Criteria changed ${since}.`);
  }

  const acceptance = run.acceptance ?? await rebuildEvalRunAcceptance(scope, run);
  if (acceptance === null) return notVerified(`Eval Run ${run.id.slice(0, 8)} has not finished.`);
  const runLabel = `Eval Run ${run.id.slice(0, 8)}`;
  const verdict = acceptance.status === 'met' ? `${runLabel} met its Acceptance Criteria` : `${runLabel}: ${acceptance.reason}`;
  const signed = (await rows.qualifications()).find((qualification) => qualification.evalRunId === run.id);
  if (signed === undefined) {
    const runVerdict = acceptance.status === 'met' ? 'passed' : acceptance.status === 'missed' ? 'missed' : 'not_judged';
    const said = runVerdict === 'passed' ? 'its Acceptance Criteria were met' : acceptance.reason;
    return {
      status: 'awaiting_approval',
      evalRunId: run.id,
      reason: `${runLabel} ${runVerdict === 'not_judged' ? 'not judged' : runVerdict}: ${said}. Waiting for a person to confirm or overwrite the verdict.`,
      runVerdict,
      runInProgress,
    };
  }
  const outcome = qualificationOutcome(signed);
  const by = `${signed.signature.signerName}`;
  const reason = signed.decision === 'confirmed'
    ? `${verdict}; ${by} confirmed it.`
    : `${verdict}; ${by} overwrote it: ${signed.deviations[0]?.justification ?? 'no reason recorded'}.`;
  return { status: outcome, evalRunId: run.id, reason, runInProgress };
}

/** An Agent's Evaluation as it stands now, each Agent read at most once; null when the caller cannot see it or it cannot be evaluated. */
type AgentValidations = (agentId: string) => Promise<{ agent: AgentDefinition; qualification: GetStepQualificationOutput } | null>;

function agentValidations(scope: CallerScope): AgentValidations {
  const reads = new Map<string, ReturnType<AgentValidations>>();
  return (agentId) => {
    if (reads.has(agentId) === false) {
      reads.set(agentId, (async () => {
        const agent = await scope.agentDefinitions.getById(agentId);
        if (agent === null || agent.namespace === undefined) return null;
        return getStepQualification({ namespace: agent.namespace, agentId }, scope).then(
          (qualification) => ({ agent, qualification }),
          (error: unknown) => {
            if (error instanceof NotFoundError || error instanceof ForbiddenError || error instanceof ValidationError) return null;
            throw error;
          },
        );
      })());
    }
    return reads.get(agentId)!;
  };
}

/**
 * A step that has no verdict of its own takes the Agent's it runs (ADR-0029
 * D8), when it runs that Agent as it was validated (`agentStepChanges`), in
 * the Agent's own workspace — whose tool catalog its trials resolved MCP
 * servers from — and the Agent's current version passed. Its own verdict,
 * once read, stands.
 */
async function withAgentValidation(
  validations: AgentValidations,
  definition: WorkflowDefinition,
  workflowStep: WorkflowStep,
  own: StepValidation,
): Promise<StepValidation> {
  if (own.status !== 'not_verified' || workflowStep.agentId === undefined) return own;
  const read = await validations(workflowStep.agentId);
  if (read === null || read.agent.namespace !== definition.namespace || read.qualification.validation.status !== 'passed') return own;
  if (agentStepChanges(workflowStep, read.agent, definition).length > 0) return own;
  const { agent, qualification } = read;
  if (qualification.agentVersion === null) return own;
  return {
    ...qualification.validation,
    reason: `Runs agent '${agent.name}' v${qualification.agentVersion} as it was validated: ${qualification.validation.reason}`,
    runInProgress: own.runInProgress,
    inheritedFromAgent: { agentId: agent.id, name: agent.name, version: qualification.agentVersion },
  };
}

/**
 * The Step's qualification badge (ADR-0023 D11): `qualified` when some signed
 * qualification that passed — confirmed met, or overwritten from missed — binds the Step's Fingerprint as it is now — in the runnable
 * version, or the version asked about — `stale` when qualifications exist but
 * none binds it, `not_qualified` when none passed. Evaluators changed
 * since the qualification shown are flagged beside it (D7). Beside it, the
 * step's validation in that version (`stepValidation`), or its Agent's
 * (`withAgentValidation`).
 */
export async function getStepQualification(
  input: z.output<typeof GetStepQualificationInputSchema>,
  scope: CallerScope,
): Promise<GetStepQualificationOutput> {
  const step = subjectRef(input);
  if (step.kind === 'agent' && input.definitionVersion !== undefined) {
    throw new ValidationError(`${subjectName(step)} is read as it is now; it has no workflow version to pick`);
  }
  const trialEnv = step.kind === 'agent' ? (await scope.evaluation.getMcpPolicy(step))?.env : undefined;
  const { definition, step: workflowStep, agent } = await loadEvaluationSubject(scope, step, 'read', input.definitionVersion, trialEnv);
  const fingerprint = await computeStepFingerprint(scope, definition, workflowStep);
  const rows = subjectRows(scope, step);
  const agentVersion = agent === null ? null : await currentAgentVersion(scope, agent);
  const version: ValidatedVersion = agent === null
    ? definitionVersionOf(definition.version)
    : agentVersion === null
      ? { subject: 'agent', label: `agent '${agent.id}' as it is now (it changed since its newest version)`, ran: () => false }
      : { subject: 'agent', label: `agent version ${agentVersion.version}`, ran: (run) => run.agentVersion === agentVersion.version };
  const versions = { definitionVersion: agent === null ? definition.version : null, agentVersion: agentVersion?.version ?? null };
  const history = [...await rows.qualifications()];
  const approvals = history.filter((qualification) => qualificationOutcome(qualification) === 'passed');
  const matching = approvals.find((qualification) => qualification.fingerprint.hash === fingerprint.hash);
  const shown = matching ?? approvals[0] ?? history[0];
  const ownValidation = await stepValidation(scope, rows, workflowStep, version, async () => fingerprint);
  const validation = agent === null ? await withAgentValidation(agentValidations(scope), definition, workflowStep, ownValidation) : ownValidation;
  if (shown === undefined || approvals.length === 0) {
    return { status: 'not_qualified', validation, qualification: shown ?? null, ...versions, fingerprint, changed: [], evaluatorsChanged: [], history };
  }
  return {
    status: matching === undefined ? 'stale' : 'qualified',
    validation,
    qualification: shown,
    ...versions,
    fingerprint,
    changed: changedFingerprintComponents(shown.fingerprint, fingerprint),
    evaluatorsChanged: evaluatorChanges(await rows.evaluators(), shown.evaluators, 'qualified with'),
    history,
  };
}

/**
 * Every evaluable agent's validation status in the namespace, one request
 * instead of one per agent — the same per-agent read `getStepQualification`
 * does, through the same `agentValidations` cache.
 */
export async function listAgentValidations(
  input: z.output<typeof ListAgentValidationsInputSchema>,
  scope: CallerScope,
): Promise<ListAgentValidationsOutput> {
  const agents = (await scope.agentDefinitions.list(input.namespace))
    .filter((agent) => agent.kind === 'plugin' && agent.runtimeId !== undefined);
  const validations = agentValidations(scope);
  const entries = await Promise.all(agents.map(async (agent) => {
    const read = await validations(agent.id);
    return read === null ? null : [agent.id, read.qualification.validation.status] as const;
  }));
  return { statuses: Object.fromEntries(entries.filter((entry) => entry !== null)) };
}

/**
 * Whether each live version of a workflow is verified: every agent step's
 * validation in that version (`stepValidation`, or its Agent's through
 * `withAgentValidation`), rolled up — `passed` when all
 * passed, `failed` when any failed, `awaiting_approval` when one waits for a
 * signature, else `not_verified`. Archived versions are
 * not evaluated, so they are left out.
 */
export async function getWorkflowValidation(
  input: z.output<typeof GetWorkflowValidationInputSchema>,
  scope: CallerScope,
): Promise<GetWorkflowValidationOutput> {
  const definitions = await scope.workflowDefinitions.listVersions(input.namespace, input.workflowName);
  if (definitions.length === 0) throw new NotFoundError(`Workflow '${input.workflowName}' not found`);
  const validations = agentValidations(scope);
  const rowsByStep = new Map<string, SubjectRows>();
  const rowsOf = (stepId: string): SubjectRows => {
    if (rowsByStep.has(stepId) === false) rowsByStep.set(stepId, subjectRows(scope, { kind: 'step', namespace: input.namespace, workflowName: input.workflowName, stepId }));
    return rowsByStep.get(stepId)!;
  };

  const live = definitions.filter((definition) => definition.archived !== true).sort((left, right) => right.version - left.version);
  const versions = await Promise.all(live.map(async (definition): Promise<WorkflowVersionValidation> => {
    const steps = await Promise.all(definition.steps.filter((workflowStep) => workflowStep.executor === 'agent').map(async (workflowStep) => ({
      stepId: workflowStep.id,
      stepName: workflowStep.name,
      validation: await withAgentValidation(
        validations,
        definition,
        workflowStep,
        await stepValidation(scope, rowsOf(workflowStep.id), workflowStep, definitionVersionOf(definition.version), () => computeStepFingerprint(scope, definition, workflowStep)),
      ),
    })));
    const statuses = steps.map((entry) => entry.validation.status);
    const status = statuses.includes('failed')
      ? 'failed'
      : statuses.length > 0 && statuses.every((stepStatus) => stepStatus === 'passed')
        ? 'passed'
        : statuses.includes('awaiting_approval') ? 'awaiting_approval' : 'not_verified';
    return { definitionVersion: definition.version, status, steps };
  }));
  return { versions };
}

/**
 * A person signs a Step Qualification for a finished Eval Run (ADR-0023
 * D10) — not a cancelled one. It binds the run's Step Fingerprint and cites the run,
 * the Evaluator versions, the MCP eval policy and the
 * Acceptance Criteria frozen into it, with the verdict on them. The signer
 * confirms that verdict or overwrites it; overwriting records a deviation with
 * a written justification, and confirming takes none — either mismatch is
 * refused. A run is signed once. Only a person signs — an API key cannot, and the
 * Evaluation Assistant has no tool for it (D15).
 */
export async function signStepQualification(
  input: z.output<typeof SignStepQualificationInputSchema>,
  scope: CallerScope,
): Promise<SignStepQualificationOutput> {
  if (scope.caller.kind !== 'user') throw new ForbiddenError('A Step Qualification is signed by a person; an API key cannot sign one');
  const uid = scope.caller.uid;
  const run = await scope.evaluation.getEvalRun(input.evalRunId);
  if (run === null) throw new NotFoundError(`Eval Run '${input.evalRunId}' not found`);
  const step = subjectRef(run);
  await loadEvaluationSubject(scope, step, 'edit', runVersionOf(run));

  const trials = await scope.evaluation.listTrials(run.id);
  const inFlight = trials.some((trial) => trial.status === 'pending' || trial.status === 'running' || trial.status === 'scoring');
  if (run.status === 'prepared' || run.status === 'running' || inFlight) {
    throw new ConflictError(`Eval Run '${run.id}' has not finished; sign once every trial is scored`);
  }
  if (run.status === 'cancelled') throw new ConflictError(`Eval Run '${run.id}' was cancelled; qualify a step on a run that finished`);
  const { fingerprint } = run;
  if (fingerprint === null) {
    throw new ValidationError('This Eval Run was prepared before Step Fingerprints; run the step again to qualify it');
  }
  if (run.acceptanceCriteria === null) {
    throw new ValidationError('No Acceptance Criteria were frozen into this Eval Run; set them and run the step again');
  }

  const report = await buildEvalRunReport(scope, run, trials);
  const verdict = report.criteriaVerdict;
  if (verdict === null) throw new ValidationError('No Acceptance Criteria were frozen into this Eval Run; set them and run the step again');
  if (input.decision === 'confirmed' && input.justification !== undefined) {
    throw new ValidationError('Confirming the verdict records no deviation; a justification is for overwriting it');
  }
  if (input.decision === 'overwritten' && input.justification === undefined) {
    throw new ValidationError('Overwriting the verdict records a deviation — give a written justification for it');
  }
  if ((await scope.evaluation.listQualifications(step)).some((existing) => existing.evalRunId === run.id)) {
    throw new ConflictError(`Eval Run '${run.id}' was already signed`);
  }
  const deviations = input.justification === undefined ? [] : [{ justification: input.justification }];
  const outcome = qualificationOutcome({ decision: input.decision, verdicts: [verdict] });

  const metadata = scope.system.userDirectory === null ? null : await scope.system.userDirectory.getUserMetadata(uid).catch(() => null);
  const signedConcurrently = async (): Promise<boolean> =>
    (await scope.evaluation.listQualifications(step)).some((existing) => existing.evalRunId === run.id);
  const qualification = await scope.evaluation.createQualification({
    ...evaluationOwnerOf(step),
    id: randomUUID(),
    evalRunId: run.id,
    definitionVersion: run.definitionVersion,
    agentVersion: run.agentVersion,
    fingerprint,
    evaluators: run.evaluators,
    mcpPolicy: run.mcpPolicy,
    acceptanceCriteria: run.acceptanceCriteria,
    verdicts: [verdict],
    decision: input.decision,
    deviations,
    signature: {
      signerId: uid,
      signerName: metadata?.displayName ?? metadata?.email ?? uid,
      meaning: qualificationSignatureMeaning(input.decision, outcome, step.kind),
      signedAt: new Date().toISOString(),
      reauthentication: 'session',
    },
  }).catch(async (error: unknown) => {
    // The run's unique index refuses a second signature; a reader of the first one gets the same answer as the check above.
    if (await signedConcurrently()) throw new ConflictError(`Eval Run '${run.id}' was already signed`);
    throw error;
  });
  await appendEvaluationAudit(scope, {
    action: 'step_qualification.signed',
    description: `Step Qualification signed for ${describeEvaluationSubject(step)} by ${qualification.signature.signerName}`
      + (deviations.length === 0 ? ` (${input.decision})` : ` (${input.decision}, with a deviation)`),
    namespace: step.namespace,
    entityType: 'step_qualification',
    entityId: qualification.id,
    inputSnapshot: { evalRunId: run.id, justification: input.justification ?? null },
    outputSnapshot: {
      fingerprint: qualification.fingerprint.hash,
      verdict: verdict.status,
      decision: input.decision,
      outcome,
      signature: qualification.signature,
    },
    basis: 'A person signed the Step Qualification (ADR-0023 D10, 21 CFR 11.50)',
  });
  return { qualification };
}
