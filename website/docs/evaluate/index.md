---
title: Evaluating agents and steps
sidebar_label: Evaluating agents and steps
sidebar_position: 7
---

# Evaluating agents and steps

An agent step that produced a good answer once has told you very little. The question a reviewer, an auditor or you yourself will ask is whether it keeps doing so, on the inputs it will actually meet, and how you know. **Evaluation** is where you answer that with evidence instead of a feeling.

You can evaluate two things:

- **A workflow step.** Open the workflow, go to the **Evaluation** tab, and pick a version and an agent step. Everything you set up belongs to that step in that workflow.
- **An agent.** Open the agent under **Agents** and go to its **Evaluation** tab. The suite belongs to the agent, so every workflow that uses it can lean on the same evidence.

Both look the same: a status strip at the top, four sub-tabs (**Eval Runs**, **Eval Cases**, **Evaluators** and **Optimization**) and the Evaluation Assistant beside them. Nothing here changes your workflow definition. Adding a check or a case never creates a new version.

## The three pieces

**Eval Cases** are the inputs you test with. Each one is an input the agent will see, and optionally the output you expect. A case is either *positive*, meaning the output should look like this, or *negative*, meaning it should not. A good set has both: the ordinary inputs the step sees every day and the awkward ones that have caught it out before.

**Evaluators** are the checks. Each one pairs a rule in plain words with the check behind it, and there are four kinds:

| Kind | What it checks |
|---|---|
| Output schema | The output has the shape the next step expects. One per subject |
| Code | A small Python or JavaScript function you write. It only counts once a person has read and approved its source |
| Model judge | Another model reads the output against your rule and says pass or fail, with how sure it is |
| Expected output | The output matches the case's expected output, exactly or by meaning |

Prefer the cheapest check that does the job. A schema check costs nothing and never has a bad day. A judge is the right tool when the rule is a matter of meaning, but it is also the one most worth spot-checking.

**Eval Runs** put the two together. A run takes a saved set of cases, runs the agent on each one several times (agents are not deterministic, so once is not enough), scores every attempt with every Evaluator, and reports a pass rate per check.

## Getting started with guided setup

An empty step or agent offers **Guided setup** or **Set up manually**. Guided setup walks you through four stages, each with its own conversation with the assistant:

1. **Brief.** A few sentences on what the step is for and who relies on it. Optional, but everything the assistant proposes later is better for it. **Draft the Brief** gives you a starting point.
2. **Eval Cases.** You're asked whether you know the correct outputs. **Cases from runs** turns real past runs into cases, and **Suggest edge cases** proposes the awkward ones, including copies of a real output with one obvious mistake planted in them, so you can see whether your checks would catch it.
3. **Evaluators.** **Propose checks** drafts up to five, cheapest kind first, and tries the schema and code checks on your cases before you accept them.
4. **Summary.** Set the pass rate you consider good enough, then **Save**, or **Save and start Eval Run**.

You can leave for **Manual setup** at any point and come back to **Guided setup** from the same place.

## Cases from real runs

The best cases are often ones you already have. A run that someone approved makes a positive case. A run a reviewer rejected, or sent back for revision, makes a negative one, and the reviewer's comment becomes part of how the case is judged. In other words, every time someone on your team says "not like this", you can keep that as a test.

For an agent, the run picker also offers runs from the workflows that use it, grouped by whether they run the agent as it is or change it.

Cases reach an Eval Run only once you **Save** them as a numbered Dataset version. That's deliberate: a run should always say exactly which cases it was judged on.

## Running an evaluation, and paying for it

Starting a run shows you an estimate and a budget cap before anything is spent, and you confirm that amount. If the run reaches the cap, the remaining attempts are skipped and the run ends as `budget_exceeded` rather than quietly spending more.

The assistant can prepare a run but cannot start one on its own. If you'd like it to, open **Advanced** in its panel and give it an unattended budget for that one request.

When a run finishes, it waits for a person. You either **Confirm** the verdict or **Overwrite** it with a written reason. Judges get the same treatment: you can **Accept** or **Deny** any single judge verdict, and a verdict the judge wasn't confident about doesn't count until someone accepts it. Signing off happens in the app, because an API key can't stand in for a person.

Each run has its own page with a summary, the individual trials, per-Evaluator results, the judges' verdicts and a **Problems** view. If some checks couldn't run at all, the summary says so at the top in red, so a missing result is never mistaken for a pass.

## What "verified" means

Once a signed run meets your pass rate, the step is **Validation passed** and the workflow version shows as **Verified** when every agent step in it has passed. Change the step's prompt, model or tools and the evidence goes **Stale**, because it was about a different configuration.

None of this blocks you from running anything. It is information for the people deciding whether to trust the workflow, and it sits on the page where they'll see it.

A step that uses an agent exactly as it is, without its own model, prompt, tools or output schema, can inherit the agent's validation. The workflow editor marks such agents **Verified** in its picker and tells you before you make a change that would end that.

## Checking live runs too

Turn on **Also run in production** for an Evaluator and it checks real runs as well as test ones. A failing schema or code check escalates the run to a person. A judge only records a score, so it never holds up the work. For each production check you also choose what happens when the check itself can't run: **Ignore** lets the run carry on unchecked, and **Escalate** hands it to a person.

Agents don't have production checks. Those belong to the steps that use them.

## Trying something better: Optimization

Evaluation tells you how good the current setup is. **Optimization** tells you whether a different one would be better.

On the **Optimization** sub-tab, **New Comparison** sets the current setup, the *baseline*, against one to four **Variants**. A Variant changes the model, the prompt or both, and nothing else. All of them run on the same cases with the same checks and trials, under one budget you confirm up front. If a recent run of the baseline already matches, it's reused and costs nothing.

The report compares each Variant with the baseline case by case. On every case a Variant wins, loses or ties, and a sign test turns those into a plain call:

| Call | Means |
|---|---|
| Better / Worse | The difference is unlikely to be luck (p below 0.05) |
| No clear difference | It might be real, but these cases can't tell |
| Too few cases | Fewer than six cases came out differently. Add cases before you decide |

A scatter of quality against cost sits beside it, because a Variant that's as good and half the price is worth knowing about too.

Applying the winner creates a new workflow version for a step, or a new agent version for an agent. It's a person's decision, so it can't be done with an API key, and today it isn't a button in the app yet either. Until it is, ask whoever runs your deployment, or make the same change yourself in the editor.

## From the CLI

Every `eval` command names its subject the same way: `--namespace <handle> --workflow <name> --step <id>` for a step, or `--namespace <handle> --agent <id>` for an agent.

```bash
pnpm exec mediforce eval case-from-run <agent-run-id> --expectation negative
pnpm exec mediforce eval run-prepare --namespace acme --workflow intake --step summarise --trials 3
pnpm exec mediforce eval run-start <eval-run-id> --confirm-budget 4.50
pnpm exec mediforce eval report <eval-run-id>
pnpm exec mediforce eval compare-prepare --namespace acme --agent <agent-id> --model anthropic/claude-haiku-5.5
```

The full list is in the [CLI reference](../reference/cli#evaluation).

:::tip If judges keep failing for no clear reason
A judge that runs out of room to answer looks like a failed check. Raise the workspace's [output budget](../workspace/#settings) and run again.
:::

Next: [Workspaces and administration](../workspace/).
