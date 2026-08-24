---
title: Verifying a workflow
sidebar_label: Verifying a workflow
sidebar_position: 5
---

# Verifying a workflow

Four checks answer "will this workflow work?", and each answers a different
question. Asking for one and getting another is the most common source of false
confidence, so they have distinct names.

Work up the ladder. Each rung assumes the ones below it passed.

## 1. Schema validation

**Question:** is the definition legal?

Runs on every save, and on `workflow register`. It checks the shape: required
fields, known executors and action kinds, transitions pointing at steps that
exist, no step orphaned from the graph. It executes nothing.

```bash
pnpm exec mediforce workflow validate ./my-workflow.wd.json
```

:::note `register --dry-run` is not a Dry Run
`workflow register --dry-run` is schema validation and executes nothing. A
**Dry Run** is a real run with agent and script work mocked. Different gates,
confusingly similar flags.
:::

## 2. Workflow readiness check

**Question:** are the image, secrets, model and credits present?

A static inspection before a run starts: a container image not on the platform, a
referenced secret that is not set, an unknown model, low credits — each reported
with the fix. It inspects; it does not execute.

It runs **in the app** when you press Start run. `mediforce run start` and
`POST /api/runs` skip it, so a CLI-driven run gets no warning.

When a probe cannot complete — an unreachable image registry, a failed credits
lookup — the dialog says **some checks could not run** rather than reporting a
pass, because a probe that failed produces no warnings, exactly like one that
passed.

## 3. Dry Run

**Question:** is the workflow structured as I intended?

A real run with **every** `agent` and `script` step swapped for a mock. The
graph, transitions, gates and human steps execute for real. It proves the shape
of the thing: branches go where you meant, verdicts route correctly, the run
reaches a terminal step.

It never answers "does the agent do what I want?" — only a real run does.

```bash
pnpm exec mediforce run start my-workflow --namespace acme --dry-run
```

:::danger A Dry Run is not a sandbox
Only `agent` and `script` steps are mocked. An `email` action **sends the mail**.
An `http` action **hits the endpoint**. A `spawn` action **starts real runs**. If
a workflow emails a regulator, a Dry Run emails the regulator.
:::

## 4. Run

**Question:** does the work produce what I wanted?

The only gate that answers behaviour. Everything executes.

## Summary

| Gate | Answers | Executes |
|---|---|---|
| Schema validation | Is it legal? | Nothing |
| Readiness check | Is what it needs present? | Nothing |
| Dry Run | Is it structured as intended? | Everything except agent and script work |
| Run | Does it produce what I wanted? | Everything |
