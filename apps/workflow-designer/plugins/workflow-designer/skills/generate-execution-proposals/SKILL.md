---
name: suggest-configs
description: "Discover available plugins and generate 2-3 ProcessConfig alternatives for a registered ProcessDefinition. Outputs an options array suitable for selection review."
---

# Suggest Workflow Configs

## Purpose

You are a workflow configuration advisor for the Mediforce workflow platform. Given a registered ProcessDefinition, you discover the available execution plugins and generate 2-3 ProcessConfig alternatives that cover different automation levels (all-human, hybrid, full-auto).

Your output must be a JSON object with an `options` array, where each option has `label`, `description`, and `value` (a complete ProcessConfig object).

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

Use the plugin names from this response when building `stepConfigs`. Only reference plugins that actually exist.

## Step 2: Read the Registered Definition

The input contains the registration result from the previous step. Read the definition to understand what steps exist:

- `input.steps['register-definition']` — contains `{ registered: true, name: "...", version: "..." }`
- `input.steps['validate-definition']` — contains `{ valid: true, yaml: "..." }` — parse this YAML to get the step list

Parse the YAML to extract:
- `name` — the workflow name (use as `processName` in configs)
- `steps` — the list of steps (you need their `id` and `type` to build `stepConfigs`)

## Step 3: Generate 2-3 Config Options

Generate configs following the ProcessConfig schema. Each option represents a different automation strategy.

### ProcessConfig Schema

```json
{
  "processName": "string",       // Must match the definition name
  "configName": "string",        // Descriptive kebab-case name (e.g., "full-auto", "human-review")
  "configVersion": "string",     // Always "1" for new configs
  "stepConfigs": [               // One entry per non-terminal step
    {
      "stepId": "string",        // Must match a step id from the definition
      "executorType": "human" | "agent" | "script",
      "plugin": "string",        // Required for agent/script types. From the plugins list.
      "autonomyLevel": "L0" | "L1" | "L2" | "L3" | "L4",  // Optional
      "confidenceThreshold": 0.0-1.0,  // Optional, default 0
      "fallbackBehavior": "escalate_to_human" | "continue_with_flag" | "pause",  // Optional
      "timeoutMinutes": 10,      // Optional
      "agentConfig": {           // Required for agent/script types
        "prompt": "string",      // For claude-code-agent: inline prompt describing what the agent should do
        "skill": "string",       // For claude-code-agent: references a SKILL.md file (only if it exists)
        "skillsDir": "string",   // For claude-code-agent: directory containing skill files
        "model": "string",       // e.g., "sonnet"
        "runtime": "javascript" | "python" | "r" | "bash",  // For script-container
        "inlineScript": "string" // For script-container
      },
      "allowedRoles": ["string"],  // Optional, RBAC
      "env": {                   // Optional, env vars for this step
        "KEY": "{{SECRET_REF}}"  // Template syntax for server secrets
      }
    }
  ],
  "roles": ["string"]           // Optional, declares roles used in this config
}
```

### Autonomy Levels

- **L0**: Human does everything, agent just observes
- **L1**: Agent suggests, human decides
- **L2**: Agent acts, human reviews every action
- **L3**: Agent acts autonomously, human reviews final output
- **L4**: Fully autonomous, no human review (scripts, automated tasks)

### Option Templates

**Option 1: All-Human (manual)**
- Every non-terminal step has `executorType: "human"`
- No plugins needed
- Good for: teams that want full manual control

**Option 2: Hybrid (recommended)**
- Data creation steps → `agent` with L3 autonomy
- Review steps → `human`
- Registration/validation scripts → `script` with L4
- Good for: balanced automation with human oversight

**Option 3: Full-Auto**
- Creation steps → `agent` with L3
- Review steps → `agent` with L3 (agent reviewer)
- Scripts → `script` with L4
- Good for: high-throughput pipelines with minimal human intervention

### Rules for Config Generation

1. **configName** must be descriptive and kebab-case (e.g., `manual`, `hybrid-claude`, `full-auto`)
2. **configVersion** always `"1"` for newly generated configs
3. **Every non-terminal step** must have a corresponding stepConfig
4. **Terminal steps** must NOT have a stepConfig
5. **Review steps** should generally be `executorType: "human"` in hybrid configs
6. **Creation steps** with `params` (data-entry) should be `executorType: "human"` — agents can't fill forms
7. **Only use plugins** that appeared in the GET /api/plugins response
8. **CRITICAL: `claude-code-agent` steps MUST have `agentConfig.prompt`** — this is a newly generated workflow with no SKILL.md files, so `skill` cannot be used. Write a clear inline prompt describing what the agent should do, what input it receives, and what output format it must produce. The prompt should be detailed enough for the agent to complete the step without any other context.
9. For `claude-code-agent` steps, include `agentConfig.model` (use `"sonnet"`)
10. Each option needs a distinct `label` and `description` explaining the trade-offs

### Output Shape

The options array must follow this structure for the selection review UI:

```json
{
  "options": [
    {
      "label": "Manual — Full Human Control",
      "description": "All steps executed by humans. Maximum oversight, no AI automation.",
      "value": { /* complete ProcessConfig object */ }
    },
    {
      "label": "Hybrid — AI + Human Review",
      "description": "AI handles creation, humans review. Recommended balance of speed and control.",
      "value": { /* complete ProcessConfig object */ }
    },
    {
      "label": "Full Auto — Minimal Human Touch",
      "description": "AI handles most steps including reviews. Fastest execution, least oversight.",
      "value": { /* complete ProcessConfig object */ }
    }
  ],
  "summary": "Generated 3 config options for workflow 'xyz': manual, hybrid, and full-auto."
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
    "register-definition": { "registered": true, "name": "...", "version": "..." },
    "validate-definition": { "valid": true, "yaml": "..." }
  }
}
```

Parse `steps['validate-definition'].yaml` to get the full workflow definition structure.
