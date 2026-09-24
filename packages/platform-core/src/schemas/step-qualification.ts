import { z } from 'zod';
import {
  AcceptanceCriteriaSchema,
  EvaluatedStepSchema,
  EvaluatorSeveritySchema,
  McpEvalServerPolicySchema,
  StepVariantPatchSchema,
} from './evaluation';
import {
  AcceptanceCriterionVerdictSchema,
  EvalRunEvaluatorSchema,
  EvalVariantSchema,
  StepFingerprintSchema,
} from './eval-run';

/** Signing although a criterion was missed, or could not be judged, records why (D10). */
export const QualificationDeviationSchema = z.object({
  severity: EvaluatorSeveritySchema,
  justification: z.string().trim().min(1).max(4000),
});

/**
 * An electronic signature on a Step Qualification, as 21 CFR 11.50 asks of a
 * signed record: who signed, when, and what the signature means. At signing
 * the signer proves who they are again — with their password, or, on a
 * deployment without password sign-in, with their session only.
 */
export const ElectronicSignatureSchema = z.object({
  signerId: z.string().min(1),
  signerName: z.string().min(1),
  meaning: z.string().min(1),
  signedAt: z.iso.datetime(),
  reauthentication: z.enum(['password', 'session']),
});

/** What a signature on a Step Qualification means, shown to the signer before they sign and kept with it. */
export function qualificationSignatureMeaning(briefVersion: number): string {
  return `Approved: I reviewed this Eval Run and qualify this Step configuration for its context of use as stated in Evaluation Brief v${briefVersion}.`;
}

/**
 * A signed decision that one Step Fingerprint met its Acceptance Criteria in
 * an Eval Run (D10, D11). It cites everything the decision rested on — the
 * run, the variant and its Fingerprint, the Brief version stating the context
 * of use, the Evaluator versions and the MCP eval policy — and is never
 * changed. It is informational: nothing is blocked without one.
 */
export const StepQualificationSchema = EvaluatedStepSchema.extend({
  id: z.uuid(),
  evalRunId: z.uuid(),
  definitionVersion: z.number().int().positive(),
  variantId: EvalVariantSchema.shape.id,
  variantLabel: z.string(),
  patch: StepVariantPatchSchema,
  fingerprint: StepFingerprintSchema,
  briefVersion: z.number().int().positive(),
  evaluators: z.array(EvalRunEvaluatorSchema),
  mcpPolicy: z.record(z.string(), McpEvalServerPolicySchema),
  acceptanceCriteria: AcceptanceCriteriaSchema,
  verdicts: z.array(AcceptanceCriterionVerdictSchema),
  deviations: z.array(QualificationDeviationSchema),
  signature: ElectronicSignatureSchema,
});

/**
 * The badge (D11): `qualified` when the Step's current Fingerprint is the one
 * its newest qualification signed, `stale` when it differs, `not_qualified`
 * when nothing was ever signed.
 */
export const StepQualificationStatusSchema = z.enum(['qualified', 'stale', 'not_qualified']);

export type QualificationDeviation = z.infer<typeof QualificationDeviationSchema>;
export type ElectronicSignature = z.infer<typeof ElectronicSignatureSchema>;
export type StepQualification = z.infer<typeof StepQualificationSchema>;
export type StepQualificationStatus = z.infer<typeof StepQualificationStatusSchema>;
