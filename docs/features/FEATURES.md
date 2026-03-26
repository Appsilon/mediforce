# Feature Gallery

Visual documentation of Mediforce features, auto-generated from E2E journey tests.

## Contents

**Tasks**
- [Task Browsing & Grouping](#task-browsing--grouping) — list, display options, action grouping
- [Task Detail & Verdict](#task-detail--verdict) — verdict form, previous step output
- [Task States](#task-states) — claimed and completed task views

**Workflows**
- [Workflow Home](#workflow-home) — workflow cards, run counts, navigation
- [Workflow Editor — Browse](#workflow-editor--browse) — tabs, definitions list
- [Workflow Editor — Edit Mode](#workflow-editor--edit-mode) — diagram, step editing, add/cancel

**Process Runs**
- [Run Detail — Step Graph](#run-detail--step-graph) — step status, verdicts, step history
- [Run Detail — Completed](#run-detail--completed) — all steps completed
- [Run Detail — Autonomy Badges](#run-detail--autonomy-badges) — L2/L4 badges, new-style runs
- [Cancel Run](#cancel-run) — double-confirm cancel flow
- [Run Report](#run-report) — timeline, detail toggle, branding
- [Report Unavailable](#report-unavailable) — guard for non-completed runs

**Agents**
- [Agent Catalog & History](#agent-catalog--history) — plugin cards, run history, detail page
- [Agent Escalated Run](#agent-escalated-run) — low confidence rationale
- [New Agent Form](#new-agent-form) — creation form

---

## Tasks

### Task Browsing & Grouping

Browse pending tasks in flat list, toggle Display options to group by Action.

![task-browse-and-grouping](task-browse-and-grouping.gif)

### Task Detail & Verdict

Open a pending human review task, see verdict buttons (approve/revise), expand previous step output.

![task-detail-verdict-form](task-detail-verdict-form.gif)

### Task States

Claimed task shows approve and revise buttons. Completed task shows completion record.

![task-claimed-and-completed](task-claimed-and-completed.gif)

---

## Workflows

### Workflow Home

Workflow cards grouped by definition with run counts and active badges. Click hash ID to navigate to run detail.

![workflow-home](workflow-home.gif)

### Workflow Editor — Browse

Workflow detail page with Runs and Definitions tabs. Switch to Definitions to see versions.

![workflow-editor-browse](workflow-editor-browse.gif)

### Workflow Editor — Edit Mode

Definition diagram with step nodes. Edit mode: click steps to edit, "+" to add, Cancel discards changes.

![workflow-editor-edit-mode](workflow-editor-edit-mode.gif)

---

## Process Runs

### Run Detail — Step Graph

Step status panel with all workflow steps, live status, verdict labels, and step history timeline.

![run-detail-step-graph](run-detail-step-graph.gif)

### Run Detail — Completed

Completed process run with all steps showing Completed status.

![run-detail-completed](run-detail-completed.gif)

### Run Detail — Autonomy Badges

Autonomy level badges (L2, L4) from process config. New-style workflow runs render correctly.

![run-detail-autonomy-badges](run-detail-autonomy-badges.gif)

### Cancel Run

Cancel button → double-confirm dialog → dismiss with "Keep running" → back to idle.

![cancel-run](cancel-run.gif)

### Run Report

Report with step timeline, timing info, brief/full detail toggle, branding, and print button.

![run-report](run-report.gif)

### Report Unavailable

Non-completed runs show "only available for completed runs" message.

![run-report-unavailable](run-report-unavailable.gif)

---

## Agents

### Agent Catalog & History

Plugin cards with metadata, Run History tab with autonomy badges, agent run detail with model/confidence/output.

![agent-catalog-and-history](agent-catalog-and-history.gif)

### Agent Escalated Run

Escalated agent run (low confidence) with detailed rationale for uncertainty.

![agent-escalated-run](agent-escalated-run.gif)

### New Agent Form

Agent creation page with name, foundation model, and save button.

![agent-new-form](agent-new-form.gif)
