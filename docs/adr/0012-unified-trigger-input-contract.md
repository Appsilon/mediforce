---
status: accepted
---

# Trigger Input is a workflow's total input contract; every trigger validates against it

A Workflow Definition's **`triggerInput`** is the **total, trigger-agnostic input
contract** — the named, typed fields any firing must supply, regardless of which
Trigger kind fires it. Every firing of every Trigger (`manual`, `webhook`, `cron`)
and every spawned child workflow validates its payload against `triggerInput`; the validated result is the
**Trigger Payload** (`triggerPayload`) that Steps read as `${triggerPayload.<field>}`.
Raw transport metadata (webhook `headers`/`query`/`method`/`path`, cron
`firedAt`/`schedule`) lives on a separate **Trigger Context** (`triggerContext`)
that carries no declared input. This completes ADR-0011: once the Definition is
trigger-free, the one thing it still owns — its input contract — must be honoured
identically no matter what fires it, so a Step never encodes which Trigger started
the Run.

**Driver:** after ADR-0011 detaches triggers, `${triggerPayload.body}` in a Step
still hard-codes "a webhook started me," and `triggerInput` is enforced on only the
manual/API path. Workflows are not truly decoupled from triggers until the input
contract is uniform.

## Decisions

- **Total contract, always validated.** Validation runs on every path (no
  `triggerInput.length > 0` guard). An empty/absent contract means the payload
  must be empty. Undeclared fields are a **hard error** (strict), uniformly —
  no per-trigger lenient mode.
- **One input channel.** The webhook JSON body's top-level keys map 1:1 to
  `triggerInput` fields. Opaque, un-enumerable input (a proxied third-party body)
  is declared as a single field of a new **`object`** type; the sender nests under
  that key. `triggerContext` is transport-only and never carries input. The
  webhook adapter strips `authorization`, `proxy-authorization`, `cookie`, and
  `x-api-key` before persisting the remaining headers in the context.
- **A field's `default` belongs to the contract, not to the form.** `validatePayload`
  fills the declared default in for every field a firing omitted (`undefined`/`null`;
  a supplied `false` / `0` / `''` is a value) and returns the resolved payload every
  path fires with — otherwise "the same contract for every trigger" would still mean
  a different payload per trigger, since only the manual form ever read `default`.
  A `required` field with a `default` is therefore satisfiable by a payload-less
  cron row, and a default that violates its own declared type fails at fire time.
- **Cron carries a static payload.** Because cron has no caller, each cron Trigger
  row holds an optional `payload` in its config (editable per row from UI/CLI, so
  two schedules can fire different payloads). It is validated at attach/update time
  against the current contract (fail-fast) and again at fire time against the
  resolved version's contract — a drifted payload **skips the tick with an audit
  reason**, never a hard error.

## Considered options

- **Keep per-trigger payload shapes (status quo).** Rejected: `${triggerPayload.body}`
  couples Steps to the webhook trigger; cron/webhook bypass the contract entirely.
- **Raw-body escape hatch (`triggerContext.body`) kept permanently.** Rejected: a
  second, *unvalidated* input channel bypasses the contract and re-opens "what is
  actually in the body?" — the exact ambiguity this decision removes. Opaque bodies
  go through a declared `object` field instead.
- **Lenient (drop undeclared fields) for webhooks.** Rejected: re-introduces a
  per-trigger behavioural difference — the coupling we are removing — and hides
  sender typos.
- **Forbid cron on workflows with required input (no static payload).** Rejected:
  a cron that fires a workflow needing even one constant input would be impossible;
  the constant belongs on the mutable Trigger row, not the immutable Definition.

## Consequences

- **Breaking, no shim.** `triggerPayload.body`/`.headers`/`.query`/`.schedule`/
  `.firedAt` stop resolving; raw transport moves to `triggerContext.*`. Our own
  example workflows, fixtures, and tests migrate in the epic; there is no
  deprecation window.
- `TriggerInputFieldSchema` gains an `object` type; `payload-validator` validates
  it as an opaque non-null JSON object. There is deliberately **no `array` type**:
  a webhook body maps by top-level key, so an opaque array has nothing to map and
  nests under an `object` field instead — one escape hatch, not two.
- The cron trigger config schema grows an optional validated `payload`; the cron
  fire path gains the same validation every other trigger runs.
- Spawned child workflows use the same validation before firing; failures follow
  the existing `errors[]` / `continueOnSpawnError` behavior.
- The webhook UI's example body becomes **derivable from `triggerInput`** rather
  than a guessed placeholder.
- See `CONTEXT.md` — "Trigger Input", "Trigger Payload", "Trigger Context".
