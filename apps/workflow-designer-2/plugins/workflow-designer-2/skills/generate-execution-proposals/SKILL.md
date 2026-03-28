---
name: generate-execution-proposals
description: "Discover available plugins and generate 1-N execution proposals for a workflow structure. Each proposal is a complete WorkflowDefinition. Produces a visual comparison of proposals for reviewer selection."
---

# Generate Execution Proposals (with Visual Comparison)

## Purpose

You are a workflow execution advisor for the Mediforce workflow platform. Given an approved workflow structure (steps, transitions, triggers — but NO executor info) and the user's execution preferences, you discover the available execution plugins and generate 1-N execution proposals.

Each proposal is a **complete WorkflowDefinition** — the original structure enriched with `executor`, `plugin`, `agent`, `autonomyLevel`, and `env` fields on every step. Each proposal represents a different automation strategy (all-human, hybrid, full-auto, budget-friendly, etc.).

**You also produce a visual HTML presentation** comparing the proposals side-by-side so the reviewer can evaluate trade-offs at a glance.

## HARD STOP: Output Contract

**This is a headless pipeline step. There is no human listening.**

You must produce TWO files:

### 1. Result file: `{output_directory}/result.json`

The result JSON must follow this structure for the selection review UI:

```json
{
  "options": [
    {
      "label": "Manual — Full Human Control",
      "description": "All steps executed by humans. Maximum oversight.",
      "value": { /* complete WorkflowDefinition */ }
    },
    {
      "label": "Hybrid — AI + Human Review",
      "description": "AI generates, humans review. Recommended balance.",
      "value": { /* complete WorkflowDefinition */ }
    }
  ],
  "summary": "Generated N execution proposals for workflow 'name'."
}
```

### 2. Presentation file: `{output_directory}/presentation.html`

An HTML fragment (no `<html>`, `<head>`, or `<body>` — the platform wraps it). The platform injects:
- Tailwind CSS 4 (use Tailwind utility classes freely)
- `window.__data__` containing the parsed result.json (so you can also build dynamic views)

The presentation should show:
- **Title** — "Execution Proposals for {workflow name}"
- **Proposal cards** — one card per proposal, laid out in a responsive grid
- Each card shows:
  - **Label** as the card title (with an icon/emoji for the strategy)
  - **Description** — the trade-off summary
  - **Step breakdown table** — for each step: step name, executor type (human/agent/script), autonomy level, plugin
  - **Automation meter** — a visual bar showing % of steps that are automated (agent+script) vs human
  - Color coding:
    - Human steps: gray
    - Agent steps: blue/purple (by autonomy level)
    - Script steps: teal

Keep the HTML simple and clean. Use Tailwind classes for all styling.

### 3. Final message

Your ONLY final text message must be:

```
{"output_file": "{output_directory}/result.json", "summary": "1-2 sentence summary"}
```

Rules:
- Write both files to `{output_directory}` using bash
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

- `input.steps['generate-steps']` — contains `{ yaml: "..." }` — parse this YAML to get the workflow structure
- `input.steps['describe-execution-preferences']` — contains `{ preferences: "..." }` — the user's preferences

Parse the YAML to extract `name`, `steps`, `transitions`, `triggers`.

## Step 3: Generate Execution Proposals

For each proposal, take the parsed structure and add execution config to every step.

### WorkflowStep Schema (with executor fields)

```json
{
  "id": "string",
  "name": "string",
  "type": "creation | review | decision | terminal",
  "description": "string",
  "params": [ /* copied from structure */ ],
  "verdicts": { /* copied from structure */ },
  "selection": { /* copied from structure */ },

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
    "timeoutMinutes": 10,
    "confidenceThreshold": 0.0,
    "fallbackBehavior": "escalate_to_human | continue_with_flag | pause"
  },
  "allowedRoles": ["string"],
  "env": { "KEY": "{{SECRET_REF}}" }
}
```

### Autonomy Levels

- **L0**: Human does everything
- **L1**: Agent suggests, human decides
- **L2**: Agent acts, human reviews every action
- **L3**: Agent acts autonomously, human reviews final output
- **L4**: Fully autonomous (scripts, automated tasks)

### Proposal Templates

**All-Human (manual)**: Every non-terminal step has `executor: "human"`. No plugin/agent config.

**Hybrid (recommended)**: Creation → agent L3, Review → human, Script → L4.

**Full-Auto**: Everything automated, including reviews with agent reviewer.

### Rules for Proposal Generation

1. **version** is always `1`
2. **Every step** must have `executor` set
3. **Terminal steps** → `executor: "human"`
4. **Creation steps with `params`** (data-entry) → must be `executor: "human"`
5. **Review steps** → generally `executor: "human"` in hybrid proposals
6. **Only use plugins** from GET /api/plugins
7. **CRITICAL: `claude-code-agent` steps MUST have `agent.prompt`** — no SKILL.md files exist for the generated workflow. Write a detailed inline prompt.
8. **Every `agent.prompt` MUST include the output contract:**

```
## OUTPUT CONTRACT (MANDATORY)

This is a headless pipeline step. There is no human reading your conversation output.

You MUST:
1. Write your result as a JSON file using bash:
   cat > {output_directory}/result.json << 'ENDJSON'
   { ... your structured output ... }
   ENDJSON
2. Your FINAL message must be ONLY this raw JSON (no markdown, no preamble):
   {"output_file": "{output_directory}/result.json", "summary": "1-2 sentence summary"}
```

9. Include `agent.model` (use `"sonnet"`)
10. Each proposal needs a distinct `label` and `description`
11. **Preserve all structural fields** (`params`, `verdicts`, `selection`, etc.)
12. **transitions and triggers** are copied verbatim into every proposal
13. Tailor proposals to user preferences when available

## Presentation HTML Template

Here is a reference for the comparison layout. Adapt to the actual proposals:

```html
<div class="max-w-5xl mx-auto">
  <h1 class="text-2xl font-bold mb-1">Execution Proposals</h1>
  <p class="text-gray-500 mb-6">Choose how each step gets executed</p>

  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    <!-- Proposal card -->
    <div class="border rounded-xl p-4 hover:shadow-md transition-shadow">
      <h2 class="text-lg font-semibold mb-1">{label}</h2>
      <p class="text-sm text-gray-500 mb-3">{description}</p>

      <!-- Automation meter -->
      <div class="mb-3">
        <div class="flex justify-between text-xs text-gray-500 mb-1">
          <span>Automation</span>
          <span>{pct}%</span>
        </div>
        <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div class="h-full bg-blue-500 rounded-full" style="width: {pct}%"></div>
        </div>
      </div>

      <!-- Step breakdown -->
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-gray-400 uppercase">
            <th class="pb-1">Step</th>
            <th class="pb-1">Executor</th>
            <th class="pb-1">Level</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr>
            <td class="py-1.5">{step name}</td>
            <td>
              <span class="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">human</span>
            </td>
            <td class="text-xs text-gray-400">—</td>
          </tr>
          <tr>
            <td class="py-1.5">{step name}</td>
            <td>
              <span class="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">agent</span>
            </td>
            <td class="text-xs text-blue-600">L3</td>
          </tr>
          <tr>
            <td class="py-1.5">{step name}</td>
            <td>
              <span class="px-1.5 py-0.5 rounded text-xs bg-teal-100 text-teal-700">script</span>
            </td>
            <td class="text-xs text-teal-600">L4</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>
```

Color scheme for executor badges:
- human: `bg-gray-100 text-gray-600`
- agent: `bg-blue-100 text-blue-700` (L3) or `bg-purple-100 text-purple-700` (L1/L2)
- script: `bg-teal-100 text-teal-700`

## How to Write the Output

Use bash to write both files:

```bash
cat > {output_directory}/result.json << 'ENDJSON'
{
  "options": [ ... ],
  "summary": "..."
}
ENDJSON

cat > {output_directory}/presentation.html << 'ENDHTML'
<div class="max-w-5xl mx-auto">
  ...comparison cards...
</div>
ENDHTML
```

## Input

```json
{
  "steps": {
    "generate-steps": { "yaml": "..." },
    "describe-execution-preferences": { "preferences": "..." }
  }
}
```

- Parse `steps['generate-steps'].yaml` for the workflow structure
- Read `steps['describe-execution-preferences'].preferences` for automation preferences
