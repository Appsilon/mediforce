# Feature Gallery

Visual documentation of Mediforce features, auto-generated from E2E journey tests.

| Feature | GIF | Tests |
|---------|-----|-------|
| [Task Browsing & Grouping](#task-browsing--grouping) | ![](task-browse-and-grouping.gif) | 1 |
| [Task Detail & Verdict](#task-detail--verdict) | ![](task-detail-verdict-form.gif) | 1 |
| [Task States](#task-states) | ![](task-claimed-and-completed.gif) | 1 |
| [Workflow Home](#workflow-home) | ![](workflow-home.gif) | 1 |
| [Run Detail — Step Graph](#run-detail--step-graph) | ![](run-detail-step-graph.gif) | 1 |
| [Run Detail — Completed](#run-detail--completed) | ![](run-detail-completed.gif) | 1 |
| [Run Detail — Autonomy Badges](#run-detail--autonomy-badges) | ![](run-detail-autonomy-badges.gif) | 1 |
| [Cancel Run](#cancel-run) | ![](cancel-run.gif) | 1 |
| [Run Report](#run-report) | ![](run-report.gif) | 1 |
| [Report Unavailable](#report-unavailable) | ![](run-report-unavailable.gif) | 1 |
| [Workflow Editor — Browse](#workflow-editor--browse) | ![](workflow-editor-browse.gif) | 1 |
| [Workflow Editor — Edit Mode](#workflow-editor--edit-mode) | ![](workflow-editor-edit-mode.gif) | 1 |
| [Agent Catalog & History](#agent-catalog--history) | ![](agent-catalog-and-history.gif) | 1 |
| [Agent Escalated Run](#agent-escalated-run) | ![](agent-escalated-run.gif) | 1 |
| [New Agent Form](#new-agent-form) | ![](agent-new-form.gif) | 1 |

---

## Tasks

### Task Browsing & Grouping

Browse pending tasks in flat list, toggle Display options to group by Action, see task counts per workflow.

![task-browse-and-grouping](task-browse-and-grouping.gif)

### Task Detail & Verdict

Open a pending human review task, see verdict buttons (approve/revise), expand previous step output with Summary and Full Output tabs.

![task-detail-verdict-form](task-detail-verdict-form.gif)

### Task States

Claimed task shows approve and revise buttons. Completed task shows completion record.

![task-claimed-and-completed](task-claimed-and-completed.gif)

---

## Workflows

### Workflow Home

Workflow cards grouped by definition, showing run counts and active badges. Click through hash ID to navigate to run detail.

![workflow-home](workflow-home.gif)

### Workflow Editor — Browse

Workflow detail page with Runs and Definitions tabs. Switch to Definitions tab to see versions.

![workflow-editor-browse](workflow-editor-browse.gif)

### Workflow Editor — Edit Mode

Open definition diagram, click step nodes for details, enter edit mode with Save/Cancel. Edit step panel, "+" button to add steps. Cancel discards changes.

![workflow-editor-edit-mode](workflow-editor-edit-mode.gif)

---

## Process Runs

### Run Detail — Step Graph

Step status panel showing all 7 workflow steps with live status, verdict labels, and step history timeline.

![run-detail-step-graph](run-detail-step-graph.gif)

### Run Detail — Completed

Completed process run with all steps showing Completed status and step history entries.

![run-detail-completed](run-detail-completed.gif)

### Run Detail — Autonomy Badges

Autonomy level badges (L2, L4) from process config. Also verifies new-style workflow runs (no configName) render correctly.

![run-detail-autonomy-badges](run-detail-autonomy-badges.gif)

### Cancel Run

Cancel a running process: click Cancel, see double-confirm dialog, dismiss with "Keep running", cancel button returns to idle.

![cancel-run](cancel-run.gif)

### Run Report

View Report link on completed run page. Report shows step timeline, timing info, brief/full detail toggle, Mediforce branding, and print button.

![run-report](run-report.gif)

### Report Unavailable

Report page for non-completed runs shows "only available for completed runs" message.

![run-report-unavailable](run-report-unavailable.gif)

---

## Agents

### Agent Catalog & History

Agent plugin cards with metadata. Run History tab showing autonomy badges (L2, L4). Agent run detail with model, confidence, reasoning, and output.

![agent-catalog-and-history](agent-catalog-and-history.gif)

### Agent Escalated Run

Escalated agent run (low confidence 0.45) showing detailed rationale for uncertainty.

![agent-escalated-run](agent-escalated-run.gif)

### New Agent Form

New Agent creation page with name, foundation model, and save button.

![agent-new-form](agent-new-form.gif)
