export {
  noopRunKicker,
  createHttpSelfFetchRunKicker,
  type RunKicker,
  type NoopRunKicker,
  type KickRecord,
  type HttpSelfFetchRunKickerConfig,
} from './run-kicker';

// Not handlers — no `(input, scope) => output` contract: the seam step execution
// uses to gate an agent run on its production Evaluators (ADR-0023 D13).
export { hasProductionEvaluators, productionEvaluatorGate } from '../handlers/evaluation/_lib/production-evaluators';
