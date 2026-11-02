---
status: accepted
audience: engineers
last_reviewed: 2026-11-02
---

# ADR-0031: An Agent's Eval Case can start from a run of a Workflow that uses it

**Date:** 2026-11-02
**Deciders:** Krystian Zieliński
**Partially supersedes:** [ADR-0029](./0029-agent-evaluation.md) D5 ("Harvesting
a case from a run … refused for an Agent", "nothing is harvested"). The rest of
ADR-0029 stays binding: an Agent still has no production runs of its own, and no
perturbed cases, previews against past outputs, drift or production Evaluators.

## Context

A Step starts its Eval Cases from its production runs. An Agent could only have
cases written by hand or by its assistant, so a person evaluating an Agent could
not reuse what the Workflows running it already saw, and an assistant's case kept
no link to the run it was written from. The Steps running an Agent are not all
alike: some run it as it was validated, others add to it (ADR-0029 D8).

## Decision

1. **A production run of a Step that used the Agent can become the Agent's
   case**, from the Add case dialog, the assistant or the CLI. Which Step used it
   is read from the Workflow version the run ran. The case belongs to the Agent,
   keeps the run as its source and is flagged as production data.
2. **Its input is what the Agent was given.** ADR-0029 D4 stays: a case holds a
   trigger payload alone, from an empty workspace. So the step's input goes into
   the trigger payload as the step merged it: literal `stepParams`, overridden by
   the step's input, overridden by its `${…}` mappings.
3. **Runs are told apart by `agentStepChanges`, the D8 rule.** A run whose Step
   adds nothing runs the Agent as it is; any other altered it, and every surface
   names the fields it altered. An altered run can be chosen, but the dialog never
   starts on one.
4. **An output under another output schema is not used.** When the Step declares
   an `outputSchema` other than the Agent's, the run's output and the verdict on
   it are withheld from the form and the assistant, and the handler refuses that
   output as an expected output. Its input stays usable, and a person may write an
   expected output of their own. A Step repeating the Agent's schema is still a D8
   change, but its output is used.

## Consequences

- The comparison is against the Agent as it is now. A Step that inherits the
  Agent's schema is not flagged when the Agent's schema changed after the run,
  because an Agent Run does not record the Agent version it ran.
- A run that read workspace files or a previous run cannot be reproduced from its
  input alone. The assistant is told to say so.
- The refusal compares against the run's exact output. It stops reuse, not a
  deliberately rewritten copy.
