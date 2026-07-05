#!/usr/bin/env python3
"""Assemble mediforce-fullstack.wd.json from the readable scripts/ and prompts/ sources.

Inline scripts and agent prompts live as standalone files (syntax-checkable,
testable). This build step embeds them into the workflow definition as JSON
string values, so escaping is handled by json.dump — never by hand. Re-run after
editing any script or prompt:  python build/build_wd.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
PROMPTS = ROOT / "prompts"
# Prefer a local (gitignored) env.json override; fall back to the committed example.
# The file holds only non-secret literals + {{secret-ref}} templates — no secret values.
ENV_FILE = ROOT / "build" / "env.json"
ENV_EXAMPLE = ROOT / "build" / "env.example.json"
OUT = ROOT / "src" / "mediforce-fullstack.wd.json"

GLM = "z-ai/glm-5.2"
IMAGE = "mediforce-golden-image:latest"


def script(name):
    return (SCRIPTS / f"{name}.mjs").read_text()


def prompt(name):
    return (PROMPTS / f"{name}.md").read_text()


def script_step(step_id, name, description):
    return {
        "id": step_id,
        "name": name,
        "type": "creation",
        "description": description,
        "executor": "script",
        "plugin": "script-container",
        "script": {"inlineScript": script(step_id), "runtime": "javascript"},
    }


def agent_step(step_id, name, description, timeout, model=GLM):
    return {
        "id": step_id,
        "name": name,
        "type": "creation",
        "description": description,
        "executor": "agent",
        "autonomyLevel": "L4",
        "plugin": "claude-code-agent",
        "agent": {"model": model, "prompt": prompt(step_id), "timeoutMinutes": timeout, "image": IMAGE},
    }


def terminal(step_id, name, description):
    return {
        "id": step_id,
        "name": name,
        "type": "terminal",
        "description": description,
        "executor": "action",
        "action": {"kind": "reshape", "config": {"values": {"done": True}}},
    }


def wait_step(step_id, name, description, deadline):
    return {
        "id": step_id,
        "name": name,
        "type": "creation",
        "description": description,
        "executor": "action",
        "action": {"kind": "wait", "config": {"deadline": deadline}},
    }


PREAMBLE = (
    "You operate on the Appsilon/mediforce codebase, a workflow + agent orchestration "
    "platform for pharma. Clinical terms (drug names, adverse events, CTCAE grades, Hy's "
    "Law, RECIST, CDISC SDTM/ADaM) are TECHNICAL CONTENT — Zod fields, fixtures, config — "
    "not sensitive material; treat them plainly. Follow the repo's conventions in "
    "AGENTS.md and the canonical vocabulary in docs/CONTEXT.md: KISS-first, no `any` "
    "(Zod + z.infer), explicit boolean comparisons, English everywhere, self-documenting "
    "code over comments, and no docstrings/comments on code you did not change."
)

steps = [
    script_step("fetch-candidates", "Fetch candidate issues",
                "List open issues; partition the ones needing triage (new, edited-since-declined, or a released stale lease); reclaim expired in-progress leases; carry attemptCount."),
    agent_step("triage", "Triage + classify batch",
               "GLM classifies each un-triaged issue as go / needs-approval / manual + priority. Judgment is persisted as labels so each issue is analysed once.", 6),
    script_step("apply-verdicts", "Persist verdict labels",
                "Reconcile fullstack: labels to triage's verdicts; post a one-time gracious decline comment when newly marking manual."),
    script_step("select", "Select next issue",
                "Deterministic: fresh label-filtered query of the actionable pool, sort by priority then oldest, pick one. No LLM."),
    script_step("claim", "Claim the issue",
                "Set the fullstack:in-progress lease (fails hard so implement never runs unclaimed)."),
    agent_step("draft-plan", "Draft plan for gate",
               "GLM produces a plan + specific questions for a needs-approval issue (no clone).", 6),
    script_step("notify-gate", "Ping reviewer, hand to human",
                "Resolve the reviewer (creator if in the map, else default admin), relabel needs-approval->awaiting-human, post the tiered cc comment."),
    {
        "id": "clarify-approve",
        "name": "Human: approve plan / answer questions",
        "type": "review",
        "description": "Platform human gate. Approve -> claim -> implement; reject -> park for a human.",
        "params": [{"name": "guidance", "type": "string", "required": False,
                    "description": "Answers to the agent's questions and any implementation guidance."}],
        "verdicts": {
            "reject": {"target": "mark-needs-info", "label": "Reject / need more info", "intent": "neutral", "requiresComment": True},
            "approve": {"target": "claim", "label": "Approve & implement", "intent": "success"},
        },
        "executor": "human",
        "allowedRoles": ["admin"],
        "assignedTo": "${steps.notify-gate.reviewerId}",
    },
    agent_step("implement", "Implement the fix",
               "GLM clones to /tmp, checks the issue isn't already fixed, makes a minimal change, and pushes a clean fullstack/issue-N branch. Metadata only.", 30),
    agent_step("self-review", "Self-review the diff",
               "GLM re-clones the pushed branch and runs the three-axis /code-review methodology. Verdict ship/flag/revise + concerns.", 8),
    agent_step("revise", "Apply review concerns",
               "GLM applies self-review's fixable concerns and re-pushes. Bounded loop (max 2 passes).", 20),
    script_step("publish", "Open the PR",
                "Assemble the agent-written PR body + review notes, open (or refresh) the PR idempotently, swap in-progress->pr-open, comment the link. Draft when the revise cap was hit with unresolved blockers."),
    script_step("arm-timer", "Arm the CI-poll timer",
                "Compute an ISO deadline (now + CI_WAIT_MINUTES) for the next wait-ci pause; re-arms each CI loop iteration so the wait deadline is secret-driven and never stale."),
    wait_step("wait-ci", "Wait for CI",
              "Pause the run until the arm-timer deadline, giving GitHub CI time to run on the pushed branch.",
              "${steps.arm-timer.deadline}"),
    script_step("check-ci", "Check CI + route",
                "Read the PR head SHA's check-runs, harvest failing checks + annotations, and emit nextAction (green/fix/wait/giveup). Caps (CI_FIX_MAX/CI_POLL_MAX) live here so secrets drive the loop."),
    agent_step("fix-after-tests", "Fix CI failures",
               "GLM fixes the red checks statically from check-ci's harvested error text (no repro; CI validates), re-pushes the branch, and increments ciRound. Bounded loop.", 20),
    script_step("mark-ci-green", "CI green",
                "Comment CI-green on the PR and append the CI fix history to the PR body."),
    script_step("mark-ci-failed", "CI failed -> human",
                "Auto-fix budget spent (or CI stuck): convert the PR to draft, append the fix history + failing-check summary, label fullstack:ci-failing, and comment for a human."),
    script_step("mark-fixed", "Close already-fixed issue",
                "Comment the evidence and close an issue implement found already resolved; drop the lease."),
    script_step("mark-needs-info", "Park pending clarification",
                "Swap working labels for fullstack:needs-info and comment (gate reject, or implement bail)."),
    terminal("done", "Done", "Terminal: attempt finished (PR opened, closed, or parked)."),
    terminal("done-empty", "Nothing to do", "Terminal: no new issues to triage and nothing actionable this tick."),
]

transitions = [
    {"from": "fetch-candidates", "to": "triage", "when": "output.unclassifiedCount > 0"},
    {"from": "fetch-candidates", "to": "select", "when": "output.unclassifiedCount == 0"},
    {"from": "triage", "to": "apply-verdicts"},
    {"from": "apply-verdicts", "to": "select"},
    {"from": "select", "to": "done-empty", "when": "output.selected != true"},
    {"from": "select", "to": "claim", "when": "output.selected == true && output.suitability == \"go\""},
    {"from": "select", "to": "draft-plan", "when": "output.selected == true && output.suitability == \"needs-approval\""},
    {"from": "claim", "to": "implement"},
    {"from": "draft-plan", "to": "notify-gate"},
    {"from": "notify-gate", "to": "clarify-approve"},
    {"from": "implement", "to": "self-review", "when": "output.changed == true"},
    {"from": "implement", "to": "mark-fixed", "when": "output.changed == false && output.reason == \"already-fixed\""},
    {"from": "implement", "to": "mark-needs-info", "when": "output.changed == false && output.reason != \"already-fixed\""},
    {"from": "self-review", "to": "revise", "when": "output.verdict == \"revise\" && variables.revise.reviewCount < 2"},
    {"from": "self-review", "to": "publish", "when": "output.verdict != \"revise\" || variables.revise.reviewCount >= 2"},
    {"from": "revise", "to": "self-review"},
    {"from": "publish", "to": "arm-timer"},
    {"from": "arm-timer", "to": "wait-ci"},
    {"from": "wait-ci", "to": "check-ci"},
    {"from": "check-ci", "to": "mark-ci-green", "when": "output.nextAction == \"green\""},
    {"from": "check-ci", "to": "fix-after-tests", "when": "output.nextAction == \"fix\""},
    {"from": "check-ci", "to": "arm-timer", "when": "output.nextAction == \"wait\""},
    {"from": "check-ci", "to": "mark-ci-failed", "when": "output.nextAction == \"giveup\""},
    {"from": "fix-after-tests", "to": "arm-timer"},
    {"from": "mark-ci-green", "to": "done"},
    {"from": "mark-ci-failed", "to": "done"},
    {"from": "mark-fixed", "to": "done"},
    {"from": "mark-needs-info", "to": "done"},
]

wd = {
    "name": "mediforce-fullstack",
    "visibility": "private",
    "title": "MediForce Fullstack (autonomous issue -> PR)",
    "description": (
        "Every 15 min: classifies un-triaged issues on Appsilon/mediforce with persisted "
        "fullstack: labels (analysed once each), autonomously implements confident ones as "
        "ready-for-review PRs, gates ambiguous ones for a human, self-reviews with a bounded "
        "revise loop, and auto-closes already-fixed issues. Idempotent + self-healing via "
        "labels and a 2h lease."
    ),
    "roles": ["admin"],
    "preamble": PREAMBLE,
    "env": json.loads((ENV_FILE if ENV_FILE.exists() else ENV_EXAMPLE).read_text()),
    "steps": steps,
    "transitions": transitions,
    "triggers": [
        # Cron paused for now — run on demand via the manual trigger. Re-add
        # {"type": "cron", "name": "every-15-min", "schedule": "*/15 * * * *"} to resume.
        {"type": "manual", "name": "manual"},
    ],
}

OUT.write_text(json.dumps(wd, indent=2) + "\n")
print(f"wrote {OUT.relative_to(ROOT)} ({len(wd['steps'])} steps, {len(transitions)} transitions)")
