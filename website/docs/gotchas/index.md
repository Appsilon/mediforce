---
title: Gotchas
sidebar_label: Gotchas
sidebar_position: 7
---

# Gotchas

Things that surprise people, and what to do instead.

## A Dry Run is not a sandbox

Only `agent` and `script` steps are mocked. Everything else executes for real: an
`email` action sends the mail, an `http` action hits the endpoint. `spawn` is the
one action that knows about dry runs — its children inherit the parent's dry-run
mode — but their own `email` and `http` actions still fire.

**Instead:** before dry-running a workflow with outward-facing actions, point them
somewhere safe — a test recipient, a staging endpoint. Or accept that the side
effect happens.

## `register --dry-run` is not a Dry Run

`workflow register --dry-run` is schema validation. It executes nothing. A **Dry
Run** is `run start --dry-run`, a real run with agent and script work mocked. Two
different gates, near-identical flags.

## The readiness check does not gate every start

It runs in the app when you press **Start run**. `mediforce run start` and
`POST /api/runs` skip it, so a CLI-driven or triggered run gets no warning about
a missing image or an unset secret — it just fails at the step that needed it.

**Instead:** start a new workflow from the UI at least once, so you see what
readiness reports before automating it.

## "Some checks could not run" is not a pass

A probe that fails produces no warnings — exactly like a probe that passed. An
unreachable image registry or a failed credits lookup is reported as *some checks
could not run*, and that is not a clean bill of health.

## A new workflow saves into the workspace you are standing in

The namespace picker on the new-workflow page defaults to the workspace in the
URL. If you deliberately pick a different one, the redirect follows your choice.
Earlier versions defaulted to the first workspace you belonged to — usually your
personal one — and then looked for the workflow in the wrong place, reporting
*"Workflow definition not found"*.

## Container steps need an image already on the platform

`script` and `agent` steps run in a container image that must be on the platform
before the run starts. A missing image fails the run at its first step.

## Executors are fixed at creation

A step's executor cannot be changed after the step exists. Delete the step and
add the one you meant.

## Editing a workflow creates a version

Nothing you save changes an existing version — definitions are immutable once
created. A run in flight is never altered underneath you, and rolling back means
pointing the default at an earlier version.

## Blocks your instance cannot support are greyed out

A block that needs a capability the deployment does not have — **Send email** with
no mail transport — stays visible but is not selectable, with the reason on hover.
It is not missing; it is unavailable.

## Enabling Google without an allowlist lets anyone in

`ALLOWED_EMAIL_DOMAINS` is enforced across every provider and is what stops any
Google account on earth signing in. With Google or OIDC enabled, set it.

## No mail transport means invitations are silent

The account and membership are created, but the invite reports *"Email not sent —
let them know to sign in"*. Nothing is queued for later; you tell them yourself.

## Losing `SECRETS_ENCRYPTION_KEY` loses every secret

Workflow secrets are encrypted at rest with it. Without the key they are
unrecoverable — not resettable, unrecoverable. Back it up off the box.

## `localhost` and `127.0.0.1` are not interchangeable

Node prefers IPv6 while the dev server binds IPv4, which surfaces as a misleading
`fetch failed`. Use `127.0.0.1` when pointing tooling at a local Mediforce.

## Low credit warns; exhausted credit fails

The readiness check reports low OpenRouter credit and still offers **Start
anyway**. Running out mid-run fails the agent step, so a long workflow can die
partway.
