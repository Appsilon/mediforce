---
title: Evaluating an agent step
sidebar_label: Evaluating an agent step
sidebar_position: 6.5
---

# Evaluating an agent step

An agent step gives a different answer each time it runs. An **evaluation**
tells you how often that answer is right: you collect example inputs, say what a
good output looks like, re-run the step on every example several times, and read
the pass rate.

This page walks you through it once, from an empty **Evaluation** tab to a
signed result. It takes about half an hour on a step that already has a few
production runs.

## The words on the tab

| Word | What it means |
|---|---|
| **Evaluator** | One check on the step's output: "the output has the required fields", "every adverse event has a CTCAE grade". It says pass or fail. |
| **Eval Case** | One input to re-run the step on, optionally with the output you expect for it. |
| **Dataset** | A saved snapshot of your Eval Cases. An Eval Run always uses the last saved Dataset, never the unsaved list. |
| **Eval Run** | The step re-run on every case of a Dataset, each case several times (**trials**), with every Evaluator grading every trial. |
| **Threshold** | The minimum pass rate every Evaluator must reach for the step to pass. |
| **Evaluation Assistant** | The chat panel on the right. It proposes checks, cases and thresholds; nothing is created until you **Accept**. |

Nothing you do on this tab changes the workflow or creates a new workflow
version.

## Before you start

- The step is an **agent** step. Only agent steps appear in the **Step** list.
- The step's MCP servers are set on its agent, not written into the step. If
  they are written into the step, the tab says *"declares MCP servers inline…
  move them onto its agent before evaluating it"*.
- The workspace has an `OPENROUTER_API_KEY` secret. The assistant, LLM judges
  and Eval Runs spend it.
- You can **edit** the workflow (to add checks and cases) and **run** it (to
  start Eval Runs). Without edit access the **Add**, **Add case** and **Save**
  buttons are not shown; without run access the **Eval Runs** start controls
  are not shown. Buttons on assistant cards and on a run's report are greyed
  out instead, with the reason on hover.
- Ideally the step has run in production a few times. You can start without
  runs, but you then write every case by hand.

## Step 1: Open the tab and pick the step

Open the workflow, then the **Evaluation** tab. At the top:

- **Version** — the workflow version to evaluate. It starts on the version new
  runs use, marked *(default)*.
- **Step** — the agent step. Each entry shows its status, for example
  *"○ not verified"*.

Below sit four sections, top to bottom: the status and threshold, **Evaluators**,
**Eval Cases** and **Eval Runs**. The **Evaluation Assistant** is on the right.

## Step 2 (optional): Write the step brief

In the assistant's header, open the **step brief**. Write two or three
sentences: what the step is for, who relies on its output, which mistakes
matter most. The assistant reads it every time you ask it something, so its
suggestions fit your step. You can also ask the assistant to draft it.

Nothing requires a brief. Skip it if you already know what to check.

## Step 3: Add Evaluators

Evaluators decide whether one output is good. Add at least one.

**The quick way.** Ask the assistant: *"What should I check on this step?"* It
returns an **Evaluation plan**: the risks, most important first, each with the
cheapest check that catches it. Click **Draft this check** on a risk. The
assistant drafts the Evaluator, tries it on real production outputs, and shows a
card with the result. **Accept** it, **Edit** it, or **Reject** it.

**By hand.** In **Evaluators**, click **Add**, choose a **Type**, fill it in
and click **Create**:

| Type | Use it when | What you fill in |
|---|---|---|
| **Output schema** | The output must have certain fields of certain types. Start here: it is free and instant. | Nothing, if the step already declares an output schema: it is pre-filled. |
| **Code** | A short script can decide the rule: a value is in range, two fields agree, a file exists. | A name, the rule in one sentence, and a Python or JavaScript script. |
| **LLM judge** | The rule needs judgment: the rationale supports the grade, nothing important is missing. | A name, the rule, and the question the model answers about each output. |
| **Expected output** | You know the right answer for some cases. | A name and the rule. The answers go on the cases (step 4). |

Pick the cheapest type that can decide the rule: schema, then code, then a
judge.

Each Evaluator shows a tag:

- **Counts** — it feeds the pass/fail result.
- **Not counted — …** — it still grades, but is ignored in the result. A
  **Code** Evaluator starts like this: a person has to read the script and click
  **Approve source** before it counts. Editing the script makes a new version
  that needs approving again.

## Step 4: Add Eval Cases

In **Eval Cases**, click **Add case**. **Start from** lists your options in
groups:

- Under **Production runs**, a run by its date and time — the case gets exactly what the step received in that
  run, and its output as the expected output. The best place to start. If a
  reviewer approved the run, the case expects the output to **match**; if they
  rejected it, **not match**. If nobody reviewed the run, the form says so:
  check the output is right before you keep it.
- Under **Eval Cases (input only)**, an existing case by name — copies its
  input, so you only change the values you want to test.
- **An empty input**, or **Load a .json file** — write the input yourself. It
  has two parts: `triggerPayload` (what started the workflow) and
  `previousStepOutputs` (what earlier steps returned, by step id).

Then:

1. Give the case a name that says what it tests, for example *"Fatal sepsis
   graded 5"*.
2. **Expected output** is optional. Leave it empty to rely on your Evaluators
   alone. If you fill it, choose whether the output must **match it** or **not
   match it**, compared **exactly** or **by meaning** (a model scores how close
   it is). An expected output is only checked if you have an **Expected output**
   Evaluator; the form warns you when you don't.
3. **Checked by** — leave **All evaluators**, or tick **Only these**.
4. Click **Add case**.

Add a handful of cases: some ordinary, some tricky, at least one that should
fail. The assistant can also synthesize edge cases from a real run: a missing
file, extreme values, renamed columns.

## Step 5: Save the cases

An Eval Run does not see a new or edited case until you save. Before your
first save, the **Eval Runs** section reads *"Save your cases to run."* next to
the **Start** button. After that, a new or edited case shows an **unsaved** tag.

Click **Save** in the **Eval Cases** header. This saves the list as a new
**Dataset** version, and the box under the list reads *"All saved — the next
Eval Run uses Dataset v1 (5 cases)"*.

Save again after every change. Until you do, the **Start** button in **Eval
Runs** is greyed out, with *"Save your cases to run"* next to it.

## Step 6 (optional): Set the threshold

At the top, click **Set the threshold**. Drag **Minimum pass rate** to the share
of trials every counting Evaluator must pass, then click **Save**. 8 passes out
of 10 meets 80%. The default is 100%: every graded trial must pass.

The assistant can suggest a threshold too; accept its card with **Use as
Acceptance Criteria**.

An Eval Run keeps the threshold that was in force when it started, so its
report does not change. The step's status does: changing the threshold sets it
back to **Not verified** until a new Eval Run finishes.

## Step 7: Start an Eval Run

In **Eval Runs**:

1. **Trials per case** — how many times each case runs, from 1 to 10. The
   default is 3. More trials give a more reliable pass rate and cost more.
2. **Budget $** — the spend at which the run stops starting new trials. Leave
   it on *auto* to set it at 1.5× the estimate shown next to it.
3. Click **Start**, read the cost in the dialog, and click **Start** again.

The run appears in the table as **Running**. Cost grows with cases × trials,
plus one model call per LLM judge per trial. For a first run, keep it small: a
few cases and 1 trial each.

When the run reaches its budget it starts no new trials and shows **Budget
reached**. Trials already running finish and count, so the final cost can go
slightly over the budget.

## Step 8: Read the results

When the run shows **Completed** or **Budget reached**, click **Details**. The **Summary** tab shows:

- **Acceptance criteria** — **met** if every counting Evaluator reached the
  threshold, **missed** if one did not, **not judged** if there was not enough
  to decide.
- The **Evaluators** table, one row per Evaluator:

| Column | What it tells you |
|---|---|
| **Pass rate** | Share of graded trials that passed, with the count: *80% (8/10)*. Green when it reached the threshold, red when it missed. |
| **95% CI** | The range the true pass rate likely sits in. With few trials it is wide; add cases or trials to narrow it. |
| **pass@k** | Share of cases where *at least one* of the k trials passed. |
| **pass^k** | Share of cases where *every one* of the k trials passed — how reliably the step gets it right. |
| **Flaky** | Share of cases that passed on some trials and failed on others. |
| **Errors** | Trials the Evaluator could not grade. |
| **Left out** | LLM judge verdicts not counted: the judge was unsure, or a person denied the verdict. |

The other tabs go deeper: **Trials** lists every trial (filter to **Failed**
or **With problems**) and opens each one with its input, output and every
Evaluator's verdict and reasoning. **Evaluators** shows what each Evaluator
checked and how. **Model verdicts** lists what each LLM judge
decided. **Problems** lists trials that errored.

### Review the judges' verdicts

If you used an LLM judge, open **Model verdicts**. Read each rationale, then:

- **Accept** a verdict to count it even though the judge was unsure.
- **Deny** a verdict the judge got wrong. It is left out of the result.

Either opens a short confirmation with an optional **Why**; click **Confirm
accept** or **Confirm deny** to record it.

The summary shows how many reviewed verdicts you denied. A high share means
the judge's question needs rewording.

### When the step fails

Ask the assistant *"Why did this run fail?"*. It reads the failures and names a
likely cause, such as an ambiguous instruction or missing context, with a fix.
Fix the step in the workflow editor, then start a new Eval Run on the new
version.

If the Evaluator is what is wrong, edit it in **Evaluators**. The edit saves a
new version; results already written keep the old one. The step goes back to
**Not verified** until you run it again.

## Step 9: Sign off the result

Every Eval Run needs a person's sign-off. Until then the step reads **Waiting
for human approval** at the top of the tab, with a **Review the Eval Run**
link.

On the run's **Summary** tab, click either:

- **Confirm that evaluation passed** (or **failed**) — you agree with the
  result.
- **Overwrite the evaluation verdict** — you disagree. Write why; the reason is
  recorded.

Then click **Sign**. The status at the top of the tab changes to **Validation
passed** or **Validation failed**, and the workflow version shows **Verified**
once all its agent steps pass.

## Keeping it valid

- **Changes reset the status.** The status goes back to **Not verified**
  when any of these change after the last Eval Run: the step itself (its
  settings, model, agent prompt, skills or tools), an Evaluator, the Eval Cases,
  or the threshold. Start a new Eval Run and sign it again.
- **Checking live runs.** Tick **Also run in production** on an Evaluator to
  grade every real run of the step. A failing **Output schema** or **Code**
  check sends the run to a person for review; an LLM judge only records its
  score. If production scores drop, a **Production Scores are drifting** alert
  appears at the top of the tab.

## Common messages

| You see | What to do |
|---|---|
| **Start** is greyed out, with *"Save your cases to run"* next to it | Click **Save** in **Eval Cases**. |
| *"Save your cases to run: Dataset v2 is behind the list"* | You changed cases since the last save. Click **Save**. |
| *"Nothing compares this yet — add an Expected output evaluator"* | Add an Evaluator of type **Expected output**, or clear the expected output. |
| *"Not counted — …"* on a Code Evaluator | Read the script, then click **Approve source**. |
| *"Auto budget is selected, but this step has no cost history…"* | Go **Back** and type a budget. |
| *"Trials per case must be a whole number from 1 to 10"* | Fix the number in **Trials per case**. |
| *"declares MCP servers inline…"* | Move the step's MCP servers onto its agent in the workflow editor. |
| No **Add**, **Add case**, **Save** or **Start** button, or a greyed-out button whose tooltip names a permission | Ask a workspace admin for edit or run access to the workflow. |

## From the command line

Everything above is also available as `mediforce eval` commands — useful for
scripting cases or running evaluations in CI:

```bash
pnpm exec mediforce eval --help
```

For which check to use when, and every option, see the engineering guide
[Choosing an evaluation](https://github.com/Appsilon/mediforce/blob/main/docs/guides/choose-an-evaluation.md).
