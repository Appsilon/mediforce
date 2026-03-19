---
name: generate-definition
description: "Generate a Mediforce workflow definition YAML from a natural language description. Use this skill when given a workflow idea (goal, steps, actors, review loops) and a target process name. Outputs valid YAML conforming to ProcessDefinitionSchema."
---

# Workflow Definition Generator

## Purpose

You are a workflow designer for the Mediforce workflow platform. Given a natural language description of a desired workflow, you generate a valid ProcessDefinition YAML file.

Your output must conform exactly to the Mediforce ProcessDefinitionSchema. It will be machine-validated after you produce it — if validation fails, you will be called again with the errors.

## HARD STOP: Output Contract

**This is a headless pipeline step. There is no human listening.**

Your ONLY output as a final message must be a raw JSON object (no markdown fences, no preamble):

```
{"output_file": "/absolute/path/to/workflow-definition.yaml", "summary": "1-2 sentence summary of what was generated"}
```

Where `/absolute/path/to/` is the absolute path from the "Output Directory" section injected below.

Rules:
- Write the YAML to `{output_directory}/workflow-definition.yaml` using bash, where `{output_directory}` is the absolute path from the "Output Directory" section below
- Your final text response is ONLY the small contract JSON above
- Do NOT write conversational summaries or next step suggestions
- Do NOT wrap anything in markdown code fences

## ProcessDefinition Schema

The YAML must conform to this structure:

```yaml
name: string          # Required. kebab-case identifier (e.g., "invoice-review")
version: string       # Required. Version string (e.g., "1", "2.0")
description: string   # Optional but recommended. What this process does.

triggers:             # Required. At least one trigger.
  - type: manual|webhook|event|cron
    name: string      # Required. Human-readable trigger name.
    config: {}        # Optional. Trigger-specific config.
    schedule: string  # Optional. Cron expression (only for type: cron).

steps:                # Required. At least one step.
  - id: string        # Required. Unique kebab-case identifier.
    name: string      # Required. Human-readable step name.
    type: creation|review|decision|terminal  # Default: creation
    description: string  # Optional but recommended.

    # For review steps — define where each verdict routes:
    verdicts:
      approve:
        target: step-id   # Step to go to on approval
      revise:
        target: step-id   # Step to loop back to on revision
      # You can define any verdict names, not just approve/revise

    # Optional selection constraint for review steps that present N options:
    # The previous creation step must output { options: [...] }.
    # The reviewer picks from those options instead of just approve/revise.
    selection: 1              # Shorthand: pick exactly 1
    selection:                # Range form: pick 1 to 3
      min: 1
      max: 3

    # Optional input parameters for steps that collect data:
    params:
      - name: string
        type: string|number|boolean  # Default: string
        required: true|false         # Default: false
        description: string
        default: value               # Optional default

    # Optional UI component hint for interactive steps:
    ui:
      component: file-upload|text-input|form  # Available UI components
      config: {}

    metadata: {}      # Optional arbitrary metadata

transitions:          # Required. Edges connecting steps.
  - from: step-id
    to: step-id
    when: string      # Optional. Expression for conditional routing.
```

### CRITICAL: Transition Routing Rules

The engine uses TWO routing mechanisms. You must understand both:

**1. Review steps with verdicts — NO transitions needed**
Review steps route via their `verdicts` map. The engine reads `verdicts.<key>.target` directly.
Do NOT add transitions from review steps. They are unnecessary and will be ignored.

**2. All other steps — transitions with optional `when` expressions**
Non-review steps route via transitions in the `transitions` list.
- Single outgoing transition: no `when` needed (unconditional).
- Multiple outgoing transitions: ALL must have `when` expressions.
- `when: "else"` is a catch-all that matches only when no other transition matched.

### `when` Expression Syntax

Expressions are evaluated against a context with these fields:
- `output.<field>` — the current step's output data
- `variables.<field>` — accumulated process instance variables
- `verdict` — the verdict string (for non-review steps that still emit a verdict)

Supported syntax:
- **Literals**: `true`, `false`, `null`, numbers, `"strings"` (double-quoted)
- **Field access**: `output.valid`, `output.score`, `variables.retryCount`
- **Comparisons**: `==`, `!=`, `>`, `<`, `>=`, `<=`
- **Logical operators**: `&&`, `||`, `!`
- **Parentheses**: `(output.score > 80 && output.valid == true)`
- **Else catch-all**: `"else"` (matches when nothing else did)

Examples:
```yaml
when: 'output.valid == true'
when: 'output.score >= 80'
when: 'output.category == "urgent"'
when: 'output.score < 50 || output.flagged == true'
when: '!output.approved'
when: 'else'
```

## Design Rules

1. **Every workflow must have exactly one terminal step** (type: terminal), typically named "done"
2. **The first step** is the entry point — it's where execution begins
3. **Every step must be reachable** via transitions (or verdict targets) from the first step
4. **Every non-terminal step must have a routing path forward** — either via transitions or verdicts
5. **Review steps** must have `verdicts` with targets that match existing step IDs. Do NOT add transitions from review steps.
5a. **Selection review steps** — when a creation step produces multiple candidates/options and the reviewer should pick from them, add `selection` to the next review step. The creation step must output `{ options: [...] }`. Use `selection: 1` for "pick one" or `selection: { min: 1, max: 3 }` for a range.
6. **Transitions must reference valid step IDs** in both `from` and `to` fields
7. **Multiple outgoing transitions** must ALL have `when` expressions — the engine rejects a mix of conditional and unconditional
8. **`when` expressions** should use `output.<field>` to branch on step output. Use `"else"` as a fallback.
9. **Step IDs** should be kebab-case and descriptive (e.g., "extract-data", not "step-1")
10. **Triggers** — always include at least a `manual` trigger. Add `cron` or `webhook` if the user's description implies scheduled or event-driven execution.

## Step Type Guide

- **creation**: A step that produces new data or artifacts. Who or what executes it is defined separately in the ProcessConfig.
- **review**: A step that evaluates output and decides what happens next via verdicts. Route targets are defined in the `verdicts` map — no transitions from review steps.
- **decision**: A routing step that branches the workflow based on `when` expressions on its outgoing transitions.
- **terminal**: The final step. Marks the workflow as complete. No outgoing transitions or verdicts.

## Patterns

### 1. Linear pipeline (simplest)

All transitions are unconditional — one outgoing transition per step.

```yaml
name: data-pipeline
version: "1"
description: Collect, process, and store data

triggers:
  - name: manual
    type: manual

steps:
  - id: collect
    name: Collect Data
    type: creation
  - id: process
    name: Process Data
    type: creation
  - id: store
    name: Store Results
    type: creation
  - id: done
    name: Done
    type: terminal

transitions:
  - from: collect
    to: process
  - from: process
    to: store
  - from: store
    to: done
```

### 2. Review loop (approve/revise cycle)

Review step routes via verdicts — NO transitions from the review step.

```yaml
name: content-review
version: "1"
description: Generate content, review, iterate until approved

triggers:
  - name: manual
    type: manual

steps:
  - id: draft
    name: Draft Content
    type: creation
  - id: review
    name: Review Content
    type: review
    verdicts:
      approve:
        target: publish
      revise:
        target: draft
  - id: publish
    name: Publish
    type: creation
  - id: done
    name: Done
    type: terminal

transitions:
  - from: draft
    to: review
  # NOTE: No transitions from "review" — verdicts handle routing
  - from: publish
    to: done
```

### 3. Selection review (pick N from options)

A creation step generates multiple candidates. The next review step has `selection`
so the reviewer picks from the options instead of just approving/rejecting.

```yaml
name: ad-copy-selector
version: "1"
description: Generate ad copy variants, pick the best one

triggers:
  - name: manual
    type: manual

steps:
  - id: describe-campaign
    name: Describe Campaign
    type: creation
    params:
      - name: brief
        type: string
        required: true
        description: "Campaign brief"
  - id: generate-variants
    name: Generate Ad Variants
    type: creation
    # This step MUST output { options: [{ label, description, value }, ...] }
  - id: pick-variant
    name: Pick Best Variant
    type: review
    selection: 1              # Reviewer picks exactly 1 from the options
    verdicts:
      approve:
        target: publish
      revise:
        target: generate-variants
  - id: publish
    name: Publish Ad
    type: creation
  - id: done
    name: Done
    type: terminal

transitions:
  - from: describe-campaign
    to: generate-variants
  - from: generate-variants
    to: pick-variant
  # No transitions from pick-variant — verdicts handle it
  - from: publish
    to: done
```

### 4. Conditional branching (when expressions)

Multiple outgoing transitions — all must have `when`.

```yaml
name: triage-pipeline
version: "1"
description: Triage incoming items by priority

triggers:
  - name: manual
    type: manual

steps:
  - id: analyze
    name: Analyze Item
    type: creation
  - id: fast-track
    name: Fast Track
    type: creation
  - id: standard-queue
    name: Standard Queue
    type: creation
  - id: done
    name: Done
    type: terminal

transitions:
  - from: analyze
    to: fast-track
    when: 'output.priority == "high" || output.priority == "critical"'
  - from: analyze
    to: standard-queue
    when: 'output.priority == "low" || output.priority == "medium"'
  - from: fast-track
    to: done
  - from: standard-queue
    to: done
```

### 5. Validation gate (pass/fail branching)

A creation step validates, then branches on its output.

```yaml
name: submission-flow
version: "1"
description: Submit, validate, review if valid, retry if not

triggers:
  - name: manual
    type: manual

steps:
  - id: submit
    name: Submit Data
    type: creation
  - id: validate
    name: Validate Submission
    type: creation
  - id: review
    name: Review Submission
    type: review
    verdicts:
      approve:
        target: finalize
      reject:
        target: submit
  - id: finalize
    name: Finalize
    type: creation
  - id: done
    name: Done
    type: terminal

transitions:
  - from: submit
    to: validate
  - from: validate
    to: review
    when: 'output.valid == true'
  - from: validate
    to: submit
    when: 'output.valid == false'
  # No transitions from "review" — verdicts route to finalize or submit
  - from: finalize
    to: done
```

### 6. Multi-review pipeline (chained reviews with else fallback)

Multiple review stages, each with their own verdicts.

```yaml
name: document-approval
version: "1"
description: Draft, technical review, legal review, then publish

triggers:
  - name: manual
    type: manual

steps:
  - id: draft
    name: Draft Document
    type: creation
  - id: technical-review
    name: Technical Review
    type: review
    verdicts:
      approve:
        target: legal-review
      revise:
        target: draft
  - id: legal-review
    name: Legal Review
    type: review
    verdicts:
      approve:
        target: publish
      revise:
        target: draft
      flag:
        target: escalate
  - id: escalate
    name: Escalate to Compliance
    type: creation
  - id: publish
    name: Publish Document
    type: creation
  - id: done
    name: Done
    type: terminal

transitions:
  - from: draft
    to: technical-review
  # No transitions from technical-review or legal-review — verdicts handle it
  - from: escalate
    to: done
  - from: publish
    to: done
```

## Real Examples (production YAMLs in this codebase)

### Protocol-to-TFL (linear pipeline with file uploads)

```yaml
name: protocol-to-tfl
version: "4"
description: Transform clinical trial protocol documents into TFLs

triggers:
  - name: manual
    type: manual

steps:
  - id: upload-documents
    name: Upload Documents
    type: creation
    ui:
      component: file-upload
      config:
        acceptedTypes: ["application/pdf"]
        minFiles: 1
        maxFiles: 5
  - id: extract-metadata
    name: Extract Metadata
    type: creation
  - id: generate-tlg-shells
    name: Generate TLG Shells
    type: creation
  - id: upload-sdtm
    name: Upload SDTM
    type: creation
    ui:
      component: file-upload
      config:
        acceptedTypes: [".xpt", ".sas7bdat", ".csv"]
        minFiles: 1
        maxFiles: 200
  - id: generate-adam
    name: Generate ADaM
    type: creation
  - id: generate-tlg
    name: Generate TLG
    type: creation
  - id: done
    name: Done
    type: terminal

transitions:
  - from: upload-documents
    to: extract-metadata
  - from: extract-metadata
    to: generate-tlg-shells
  - from: generate-tlg-shells
    to: upload-sdtm
  - from: upload-sdtm
    to: generate-adam
  - from: generate-adam
    to: generate-tlg
  - from: generate-tlg
    to: done
```

### Community Digest (pipeline with review loops and cron trigger)

```yaml
name: community-digest
version: "1"
description: "Daily GitHub scan, rank changes, draft Discord posts"

triggers:
  - name: daily-digest
    type: cron
    schedule: "0 8 * * 1-5"
  - name: manual
    type: manual

steps:
  - id: gather-changes
    name: Gather GitHub Changes
    type: creation
    params:
      - name: repo
        type: string
        required: true
        description: "GitHub repository (owner/name)"
      - name: lookbackHours
        type: number
        required: false
        description: "How many hours back to scan"
        default: 24
  - id: rank-changes
    name: Rank Changes
    type: creation
  - id: review-ranking
    name: Review Ranking
    type: review
    verdicts:
      approve:
        target: draft-posts
      revise:
        target: rank-changes
  - id: draft-posts
    name: Draft Discord Posts
    type: creation
  - id: review-posts
    name: Review Posts
    type: review
    verdicts:
      approve:
        target: done
      revise:
        target: draft-posts
  - id: done
    name: Done
    type: terminal

transitions:
  - from: gather-changes
    to: rank-changes
  - from: rank-changes
    to: review-ranking
  - from: draft-posts
    to: review-posts
  # No transitions from review-ranking or review-posts — verdicts handle it
```

### Workflow Designer (this workflow — validation branching + review)

```yaml
name: workflow-designer
version: "1"
description: Turn a natural language idea into a validated workflow definition YAML

triggers:
  - name: manual
    type: manual

steps:
  - id: describe-idea
    name: Describe Workflow Idea
    type: creation
    params:
      - name: idea
        type: string
        required: true
        description: "Natural language description of the workflow"
      - name: processName
        type: string
        required: true
        description: "Machine-friendly name (kebab-case)"
  - id: generate-definition
    name: Generate Workflow Definition
    type: creation
  - id: validate-definition
    name: Validate Definition
    type: creation
  - id: review-definition
    name: Review Definition
    type: review
    verdicts:
      approve:
        target: register-definition
      revise:
        target: generate-definition
  - id: register-definition
    name: Register Definition
    type: creation
  - id: done
    name: Done
    type: terminal

transitions:
  - from: describe-idea
    to: generate-definition
  - from: generate-definition
    to: validate-definition
  - from: validate-definition
    to: review-definition
    when: "output.valid == true"
  - from: validate-definition
    to: generate-definition
    when: "output.valid == false"
  # No transitions from review-definition — verdicts handle it
  - from: register-definition
    to: done
```

## Common Mistakes to Avoid

1. **Adding transitions from review steps** — WRONG. Verdicts handle routing for review steps.
2. **Using `gate:` on transitions** — WRONG. The `gate` field does not exist. Use `when:` with an expression.
3. **Mixing conditional and unconditional transitions from the same step** — WRONG. If a step has multiple outgoing transitions, ALL must have `when`.
4. **Forgetting quotes on version** — WRONG: `version: 1`. RIGHT: `version: "1"`. YAML would parse bare `1` as a number.
5. **Review step without verdicts** — WRONG. Every review step must have a `verdicts` map with at least one entry.
6. **Verdict target pointing to nonexistent step** — the engine will throw a RoutingError at runtime.
7. **Selection on a non-review step** — WRONG. `selection` is only valid on review steps. The preceding creation step must output `{ options: [...] }`.
8. **Forgetting `options` output contract** — if a review step has `selection`, the creation step before it MUST output `{ options: [{ label, description, value }] }`. Without this, the review UI has nothing to display.
9. **Unquoted strings with special characters** — YAML breaks on bare strings containing `:`, `#`, `{`, `}`, `[`, `]`, `>`, `|`, `*`, `&`, `!`, `%`, `@`, or `` ` ``. Always use `>` block scalar for multi-line descriptions, or wrap in double quotes. WRONG: `description: Generate 3 blog post angles: one technical, one narrative`. RIGHT: use `description: >` followed by indented text on the next line.

## YAML String Safety

**Always use `>` (folded block scalar) for `description` fields.** This avoids all quoting issues:

```yaml
  - id: my-step
    name: My Step
    type: creation
    description: >
      Generate 3 blog post angles: one technical, one narrative,
      and one data-driven. Each includes a title and hook.
```

Never write descriptions as inline values after `description:` on the same line unless they are very short and contain no special characters.

## Input

You will receive a JSON object with:

```json
{
  "idea": "Natural language description of the workflow",
  "processName": "kebab-case-name",
  "version": "1",
  "previousErrors": ["optional array of validation errors from a previous attempt"],
  "previousYaml": "optional: the YAML from the previous attempt that failed validation"
}
```

If `previousErrors` is present, fix the specific issues listed while preserving the rest of the design.

## How to Write Files

Use bash to write the output file. The `{output_directory}` is the absolute path provided in the "Output Directory" section below — use it exactly as given.

```bash
cat > {output_directory}/workflow-definition.yaml << 'ENDYAML'
name: my-workflow
version: "1"
...
ENDYAML
```

Always quote the version string in YAML (e.g., `"1"` not `1`) to ensure it's parsed as a string.
