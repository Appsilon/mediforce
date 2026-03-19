---
name: generate-execution-proposals
description: "Discover available plugins and generate 1-N execution proposals for a workflow structure. Each proposal is a complete WorkflowDefinition with executor config on every step."
---

# Generate Execution Proposals

## Purpose

You are a workflow execution advisor for the Mediforce workflow platform. Given an approved workflow structure (steps, transitions, triggers — but NO executor info) and the user's execution preferences, you discover the available execution plugins and generate 1-N execution proposals.

Each proposal is a **complete WorkflowDefinition** — the original structure enriched with `executor`, `plugin`, `agent`, `autonomyLevel`, and `env` fields on every step. Each proposal represents a different automation strategy (all-human, hybrid, full-auto, budget-friendly, etc.).

Your output must be a JSON object with an `options` array, where each option has `label`, `description`, and `value` (a complete WorkflowDefinition object).

## HARD STOP: Output Contract

**This is a headless pipeline step. There is no human listening.**

Your ONLY output as a final message must be a raw JSON object (no markdown fences, no preamble):

```
{"output_file": "/absolute/path/to/result.json", "summary": "1-2 sentence summary"}
```

Where `/absolute/path/to/` is the absolute path from the "Output Directory" section injected below.

Rules:
- Write the result JSON to `{output_directory}/result.json` using bash
- Your final text response is ONLY the small contract JSON above
- Do NOT write conversational summaries or next step suggestions
- Do NOT wrap anything in markdown code fences

## Step 1: Discover Available Plugins

Call the platform API to get the list of available plugins:

```bash
curl -s -H "X-Api-Key: $PLATFORM_API_KEY" "$APP_BASE_URL/api/plugins"
```

Response shape:
```json
{
  "plugins": [
    { "name": "claude-code-agent", "metadata": { ... } },
    { "name": "script-container", "metadata": { ... } }
  ]
}
```

Use the plugin names from this response when assigning `plugin` to steps. Only reference plugins that actually exist.

## Step 2: Read the Workflow Structure and Preferences

The input contains results from previous steps:

- `input.steps['generate-steps']` — contains `{ yaml: "..." }` — parse this YAML to get the workflow structure (steps, transitions, triggers)
- `input.steps['describe-execution-preferences']` — contains `{ preferences: "..." }` — the user's stated preferences about automation level, budget, roles, etc.

Parse the YAML to extract:
- `name` — the workflow name
- `steps` — the list of steps (each has `id`, `name`, `type`, optionally `params`, `verdicts`, `selection`)
- `transitions` — the transition rules between steps
- `triggers` — what starts the workflow

The structure YAML has NO executor fields — that is what you are adding.

## Step 3: Generate Execution Proposals

For each proposal, take the parsed structure and add execution config to every step. The result is a complete WorkflowDefinition.

### WorkflowDefinition Schema

```json
{
  "name": "string",
  "version": 1,
  "description": "string",
  "roles": ["string"],
  "steps": [ /* WorkflowStep[] */ ],
  "transitions": [ /* copied from structure */ ],
  "triggers": [ /* copied from structure */ ]
}
```

### WorkflowStep Schema (with executor fields)

Each step from the structure gets these additional fields:

```json
{
  "id": "string",
  "name": "string",
  "type": "creation | review | decision | terminal",
  "description": "string",
  "params": [ /* copied from structure if present */ ],
  "verdicts": { /* copied from structure if present */ },
  "selection": { /* copied from structure if present */ },

  "executor": "human | agent | script",
  "autonomyLevel": "L0 | L1 | L2 | L3 | L4",
  "plugin": "string",
  "agent": {
    "model": "string",
    "skill": "string",
    "prompt": "string",
    "skillsDir": "string",
    "runtime": "javascript | python | r | bash",
    "inlineScript": "string",
    "image": "string",
    "repo": "string",
    "commit": "string",
    "timeoutMs": 300000,
    "timeoutMinutes": 10,
    "confidenceThreshold": 0.0,
    "fallbackBehavior": "escalate_to_human | continue_with_flag | pause"
  },
  "review": {
    "type": "human | agent | none",
    "plugin": "string",
    "maxIterations": 3,
    "timeBoxDays": 7
  },
  "allowedRoles": ["string"],
  "env": {
    "KEY": "{{SECRET_REF}}"
  }
}
```

All executor-related fields are optional except `executor` which is required on every step.

### WorkflowAgentConfig Details

| Field | Used with | Description |
|-------|-----------|-------------|
| `model` | claude-code-agent | Model name, e.g. `"sonnet"` |
| `skill` | claude-code-agent | References a SKILL.md file (only if it exists) |
| `prompt` | claude-code-agent | Inline prompt describing what the agent should do |
| `skillsDir` | claude-code-agent | Directory containing skill files |
| `runtime` | script-container | Script runtime: `javascript`, `python`, `r`, `bash` |
| `inlineScript` | script-container | Inline script source code |
| `image` | script-container | Docker image for container execution |
| `timeoutMs` | any | Execution timeout in milliseconds |
| `timeoutMinutes` | any | Execution timeout in minutes |
| `confidenceThreshold` | agent | Minimum confidence (0.0-1.0) before auto-advancing |
| `fallbackBehavior` | agent | What to do on failure: `escalate_to_human`, `continue_with_flag`, `pause` |

### Autonomy Levels

- **L0**: Human does everything, agent just observes
- **L1**: Agent suggests, human decides
- **L2**: Agent acts, human reviews every action
- **L3**: Agent acts autonomously, human reviews final output
- **L4**: Fully autonomous, no human review (scripts, automated tasks)

### Proposal Templates

**All-Human (manual)**
- Every non-terminal step has `executor: "human"`
- No `plugin` or `agent` config needed
- Good for: teams that want full manual control, compliance-heavy workflows

**Hybrid (recommended)**
- Creation steps that generate content → `executor: "agent"`, `plugin: "claude-code-agent"`, `autonomyLevel: "L3"`
- Review steps → `executor: "human"` (human reviews agent output)
- Script/registration steps → `executor: "script"`, `plugin: "script-container"`, `autonomyLevel: "L4"`
- Good for: balanced automation with human oversight at decision points

**Full-Auto**
- Creation steps → `executor: "agent"`, `autonomyLevel: "L3"`
- Review steps → `executor: "agent"`, `autonomyLevel: "L3"` (agent reviewer)
- Scripts → `executor: "script"`, `autonomyLevel: "L4"`
- Good for: high-throughput pipelines with minimal human intervention

You may also generate additional proposals based on the user's preferences (e.g., budget-friendly with smaller models, high-security with L1 autonomy, etc.).

### Rules for Proposal Generation

1. **version** is always `1` for newly generated definitions
2. **Every step** (including terminal) must be present with its `executor` field set
3. **Terminal steps** should have `executor: "human"` (they are end states, no execution needed)
4. **Creation steps with `params`** (data-entry forms) must be `executor: "human"` — agents cannot fill interactive forms
5. **Review steps** should generally be `executor: "human"` in hybrid proposals
6. **Only use plugins** that appeared in the GET /api/plugins response
7. **CRITICAL: `claude-code-agent` steps MUST have `agent.prompt`** — this is a newly generated workflow with no SKILL.md files, so `skill` cannot be used. Write a clear inline prompt describing what the agent should do, what input it receives, and what output format it must produce. The prompt should be detailed enough for the agent to complete the step without any other context.
8. For `claude-code-agent` steps, include `agent.model` (use `"sonnet"`)
9. Each proposal needs a distinct `label` and `description` explaining the trade-offs
10. **Preserve all structural fields** from the original YAML — `params`, `verdicts`, `selection`, `description`, `metadata`, etc. must be copied as-is into every proposal
11. **transitions and triggers** are copied verbatim from the structure into every proposal
12. Tailor proposals to the user's stated preferences when available

### Output Shape

The result JSON must follow this structure for the selection review UI:

```json
{
  "options": [
    {
      "label": "Manual — Full Human Control",
      "description": "All steps executed by humans. Maximum oversight, no AI automation.",
      "value": {
        "name": "my-workflow",
        "version": 1,
        "steps": [
          {
            "id": "gather-requirements",
            "name": "Gather Requirements",
            "type": "creation",
            "params": [ ... ],
            "executor": "human"
          },
          {
            "id": "generate-report",
            "name": "Generate Report",
            "type": "creation",
            "executor": "human"
          },
          {
            "id": "review-report",
            "name": "Review Report",
            "type": "review",
            "verdicts": { ... },
            "executor": "human"
          },
          {
            "id": "done",
            "name": "Done",
            "type": "terminal",
            "executor": "human"
          }
        ],
        "transitions": [ ... ],
        "triggers": [ ... ]
      }
    },
    {
      "label": "Hybrid — AI + Human Review",
      "description": "AI handles content generation, humans review. Recommended balance of speed and control.",
      "value": {
        "name": "my-workflow",
        "version": 1,
        "steps": [
          {
            "id": "gather-requirements",
            "name": "Gather Requirements",
            "type": "creation",
            "params": [ ... ],
            "executor": "human"
          },
          {
            "id": "generate-report",
            "name": "Generate Report",
            "type": "creation",
            "executor": "agent",
            "autonomyLevel": "L3",
            "plugin": "claude-code-agent",
            "agent": {
              "model": "sonnet",
              "prompt": "You are a report generator. Read the requirements from input and produce a structured report..."
            }
          },
          {
            "id": "review-report",
            "name": "Review Report",
            "type": "review",
            "verdicts": { ... },
            "executor": "human"
          },
          {
            "id": "done",
            "name": "Done",
            "type": "terminal",
            "executor": "human"
          }
        ],
        "transitions": [ ... ],
        "triggers": [ ... ]
      }
    },
    {
      "label": "Full Auto — Minimal Human Touch",
      "description": "AI handles most steps including reviews. Fastest execution, least oversight.",
      "value": { ... }
    }
  ],
  "summary": "Generated 3 execution proposals for workflow 'my-workflow': manual, hybrid, and full-auto."
}
```

## How to Write the Output

Use bash to write the result file:

```bash
cat > {output_directory}/result.json << 'ENDJSON'
{
  "options": [ ... ],
  "summary": "..."
}
ENDJSON
```

## Input

You will receive a JSON object with:

```json
{
  "steps": {
    "generate-steps": { "yaml": "..." },
    "describe-execution-preferences": { "preferences": "..." }
  }
}
```

- Parse `steps['generate-steps'].yaml` to get the workflow structure (steps, transitions, triggers without executor info)
- Read `steps['describe-execution-preferences'].preferences` to understand the user's automation preferences
