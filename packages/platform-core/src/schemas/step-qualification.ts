import { z } from 'zod';
import {
  EvaluatedStepSchema,
  LegacyEvaluatorSeveritySchema,
  McpEvalServerPolicySchema,
  SignedAcceptanceCriteriaSchema,
} from './evaluation';
import {
  AcceptanceCriterionVerdictSchema,
  EvalRunEvaluatorSchema,
  StepFingerprintSchema,
} from './eval-run';

/**
 * What the signer decided about the verdict the Acceptance Criteria gave a run:
 * `confirmed` agrees with it (met → passed, missed or not judged → failed),
 * `overwritten` reverses it, and always carries a deviation with the reason.
 */
export const QualificationDecisionSchema = z.enum(['confirmed', 'overwritten']);

/**
 * Overwriting the verdict records why (D10). One signed while Evaluators had a
 * severity carries one per severity, naming it.
 */
export const QualificationDeviationSchema = z.object({
  severity: LegacyEvaluatorSeveritySchema.optional(),
  justification: z.string().trim().min(1).max(4000),
});

/**
 * An electronic signature on a Step Qualification, as 21 CFR 11.50 asks of a
 * signed record: who signed, when, and what the signature means. A person
 * signs from their session; one signed while a password was asked for again
 * records `password`.
 */
export const ElectronicSignatureSchema = z.object({
  signerId: z.string().min(1),
  signerName: z.string().min(1),
  meaning: z.string().min(1),
  signedAt: z.iso.datetime(),
  reauthentication: z.enum(['password', 'session']),
});

/** What a signature on a Step Qualification means, shown to the signer before they sign and kept with it. */
export function qualificationSignatureMeaning(decision: QualificationDecision, outcome: 'passed' | 'failed'): string {
  const verdict = `the Step configuration as it ran in it ${outcome} validation`;
  return decision === 'confirmed'
    ? `Confirmed: I reviewed this Eval Run and agree with its verdict: ${verdict}.`
    : `Overwritten: I reviewed this Eval Run and overwrite its verdict: ${verdict}.`;
}

/**
 * A signed decision that one Step Fingerprint met its Acceptance Criteria in
 * an Eval Run (D10, D11). It cites everything the decision rested on — the
 * run, the Step's Fingerprint, the Evaluator versions and the MCP eval
 * policy — and is never changed; one signed before variants were removed
 * still carries their keys, which reads ignore. It is informational: nothing is blocked without one.
 */
const StepQualificationRecordSchema = EvaluatedStepSchema.extend({
  id: z.uuid(),
  evalRunId: z.uuid(),
  definitionVersion: z.number().int().positive(),
  fingerprint: StepFingerprintSchema,
  evaluators: z.array(EvalRunEvaluatorSchema),
  mcpPolicy: z.record(z.string(), McpEvalServerPolicySchema),
  /** Read exactly as signed — one signed while Evaluators had a severity keeps its floor per severity. */
  acceptanceCriteria: SignedAcceptanceCriteriaSchema,
  /** The verdict on the criteria, when the run had them; one signed while Evaluators had a severity has one per severity. */
  verdicts: z.array(AcceptanceCriterionVerdictSchema.extend({ severity: LegacyEvaluatorSeveritySchema.optional() })),
  decision: QualificationDecisionSchema,
  deviations: z.array(QualificationDeviationSchema),
  signature: ElectronicSignatureSchema,
});

/**
 * One signed before decisions existed was qualified whatever its verdict: it
 * agreed with a met verdict, and over a missed or not judged one it carried a
 * deviation, which is an overwrite.
 */
export const StepQualificationSchema = z.preprocess((record) => {
  if (typeof record !== 'object' || record === null || 'decision' in record) return record;
  const verdicts: unknown = 'verdicts' in record ? record.verdicts : undefined;
  const met = Array.isArray(verdicts) && verdicts.length > 0
    && verdicts.every((verdict) => typeof verdict === 'object' && verdict !== null && 'status' in verdict && verdict.status === 'met');
  return { ...record, decision: met ? 'confirmed' : 'overwritten' };
}, StepQualificationRecordSchema);

/**
 * The badge (D11): `qualified` when any signed qualification binds the Step's
 * current Fingerprint, `stale` when qualifications exist but none binds it,
 * `not_qualified` when nothing was ever signed.
 */
export const StepQualificationStatusSchema = z.enum(['qualified', 'stale', 'not_qualified']);

/** What the step's validation reads from a signed qualification: the verdict of its run, as the signer left it. */
export function qualificationOutcome(qualification: Pick<StepQualification, 'decision' | 'verdicts'>): 'passed' | 'failed' {
  const met = qualification.verdicts.length > 0 && qualification.verdicts.every((verdict) => verdict.status === 'met');
  return met === (qualification.decision === 'confirmed') ? 'passed' : 'failed';
}

export type QualificationDecision = z.infer<typeof QualificationDecisionSchema>;
export type QualificationDeviation = z.infer<typeof QualificationDeviationSchema>;
export type ElectronicSignature = z.infer<typeof ElectronicSignatureSchema>;
export type StepQualification = z.infer<typeof StepQualificationRecordSchema>;
export type StepQualificationStatus = z.infer<typeof StepQualificationStatusSchema>;
