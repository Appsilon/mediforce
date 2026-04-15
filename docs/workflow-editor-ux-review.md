# Workflow Editor UX Review

Notes from team discussion (2026-04-15) on workflow editor usability, conceptual model, and improvement areas. Based on hands-on experience building the Pharmaverse Governance workflow.

---

## Context: The Pharmaverse Governance Workflow

A real workflow built by a non-developer user to manage pharmaceutical package governance:

1. **Script step**: Collect all packages in Pharmaverse
2. **Script step**: Gather metrics for those packages
3. **Agent step**: Assess each package (governance recommendations, badges, flags — based on Andrea's governance document)
4. **Review step**: Council reviews agent recommendations, makes decisions per package
5. **Creation step**: Generate per-package reports incorporating council decisions
6. **Review step**: Approve and auto-send reports to package maintainers

The workflow works well end-to-end. The issues below are about making the editing experience match the quality of the execution experience.

---

## Problems Identified

### P1. Script content buried under technical details

**Severity: High**

When editing a script step, the user sees runtime selector, command field, and Docker image before the actual script code. The inline script textarea is at the bottom of the "Runtime" section. For most users, the script content _is_ the step — everything else is plumbing.

### P2. No file upload for scripts

**Severity: High**

Long scripts must be embedded inline or added to the codebase by a developer. There's no way for a regular user to upload a `.py` or `.R` file as the script for a step. This creates a hard dependency on developer involvement for anything beyond trivial scripts.

### P3. Autonomy level displayed for script steps

**Severity: Medium**

The L0-L4 autonomy level toggle appears for script executor steps, where it has no meaning. Scripts don't have autonomy — they either run or they don't.

### P4. Environment variables: focus loss and manual entry

**Severity: High**

- Input fields lose focus on every keystroke (re-render issue)
- Users must manually type environment variable names and values
- Secret references (`{{SECRET_NAME}}`) must be typed, not selected
- A user unfamiliar with the `{{}}` syntax pasted an actual API key into the inline script instead of using secrets

### P5. Secrets not granularly selectable per step

**Severity: Medium**

All workflow-level secrets are available to every step. There's no per-step access control for secrets. In a security-conscious environment, a step that only needs a GitHub token shouldn't have access to database credentials.

### P6. Step type definition collapsed at bottom of editor

**Severity: Medium**

The step type selector (creation/review/decision/terminal) is inside a collapsed `<details>` element at the very bottom of the form. This is a fundamental choice about what the step does, yet it's the most hidden element. A user building step-by-step would naturally encounter this last, after configuring everything else.

### P7. Cannot run workflow from the edit screen

**Severity: Medium**

After editing a workflow, the user must navigate away to the versions/execution screen to run it. There should be a direct "Run" action from the editor.

### P8. Confidence threshold is numeric and meaningless to users

**Severity: High**

The confidence threshold is a 0.0-1.0 decimal. Users cannot reason about the difference between 0.4 and 0.5. In a pharma demo, a "70% confidence" label on workflow output was described as "terrifying — hide this before the demo." The concept of confidence is useful (agent correctly flagged low confidence when it lacked internet access), but the numeric precision is false precision.

### P9. L3 autonomy + explicit review step = double review

**Severity: Medium**

An agent at L3 ("auto + fallback") generates a review task when confidence is below threshold. If the workflow also has an explicit review step afterward, the user reviews the same output twice. This happened with the Pharmaverse workflow — the AI-generated workflow included both mechanisms without the user understanding the overlap.

### P10. Autonomy levels: L0 and L3 are confusing

**Severity: Medium**

- **L0 ("Manual only")**: An agent step with L0 means "agent does nothing, human does everything." This is indistinguishable from a human step and confuses the mental model — why create an agent step if the agent doesn't participate?
- **L3 ("Auto + fallback")**: Nobody on the team could clearly articulate what fallback means in practice or how it differs from L2 with a confidence threshold.

### P11. Review vs Decision step types are unclear

**Severity: Low**

Review is a special case of decision (approve/reject vs N-way branching). The distinction exists but isn't immediately obvious. After reading a report, the user's next action could reasonably be creation (add input), review (approve), or decision (choose path) — the types don't map cleanly to the actual interaction pattern.

### P12. "End" step type still selectable in editor

**Severity: Low**

The "Terminal/End" step type option was removed from the add-step UI but still appears in the step editor's collapsed type selector.

### P13. Revise action semantics

**Severity: Low**

In the Pharmaverse workflow, "revise" doesn't mean "you did bad work, redo it." It means "we made decisions in the council meeting — incorporate them into the report." The action name and UX don't communicate this iterative-input pattern well. The real interaction is a conversation loop, not a correction loop.

### P14. No access to previous iteration outputs

**Severity: Low**

When a step goes through multiple revise cycles (e.g., council makes decisions across three rounds), it's unclear whether previous versions of the agent's output are accessible. Only the latest iteration is visible.

---

## Conceptual Issues

### C1. Executor type vs autonomy level should be unified

**Current model (two separate choices):**
- Executor type: Human / Agent / Script / Cowork
- Autonomy level: L0 / L1 / L2 / L3 / L4

This creates confusing combinations (agent + L0 = human step?) and redundancy (cowork is really an autonomy level, not a separate executor type).

**Proposed model — one spectrum per step:**

| Level | Label | Behavior |
|-------|-------|----------|
| — | **Script** | Pure automation, no AI. Separate concept, not on the autonomy spectrum. |
| 1 | **Manual** | Human does everything. No agent involvement. |
| 2 | **Copilot** | Human works with AI side-by-side (currently "cowork"). Real-time collaboration. |
| 3 | **Supervised** | Agent does work, human reviews before proceeding. |
| 4 | **Autonomous** | Agent proceeds automatically. Confidence level (Low/Medium/High) determines when to escalate. |

This removes the executor/autonomy split. A step is either a script (automation) or somewhere on the manual-to-autonomous spectrum. "Cowork" becomes a point on the spectrum ("copilot") rather than a separate concept.

### C2. Plugin/Skill/Agent model is unclear

**Current state:**
- **Plugins** are code bundles in the repo (`apps/*/plugins/`)
- **Skills** are markdown files inside plugin folders
- **Agents** are a UI concept (select plugin + model + prompt)
- Skills are tied to specific workflow folders — can't be reused across workflows

**Problem experienced:** User created a skill file in the repo instead of creating an agent through the UI. The skill worked perfectly but is locked to one workflow. The user said: "I should have created an agent, but I just ignored agents entirely because skills worked."

**Proposed direction:** Agents as the primary reusable unit — "items on a shelf." An agent = model + skills + tools + prompt, saved in the org's library, selectable when building any workflow. This would replace the plugin/skill split with a simpler model:

- Define agents in a library (via UI or API)
- When building a workflow, pick agents from the library for agent steps
- Skills and tools are configured at the agent level, not per-step

### C3. Confidence threshold: numbers to labels

Replace the 0.0-1.0 numeric confidence threshold with human-readable labels:

| Current | Proposed | Meaning |
|---------|----------|---------|
| `0.0-0.39` | **Low** | Agent is uncertain — always escalate to human |
| `0.4-0.79` | **Medium** | Agent has reasonable confidence — context-dependent |
| `0.8-1.0` | **High** | Agent is confident — safe to auto-proceed |

The underlying numeric value can remain in the schema for programmatic use, but the UI should only expose labels. This addresses the pharma-demo concern where numeric confidence percentages were perceived as unreliable rather than informative.

### C4. Step type naming

Current names and proposed alternatives:

| Current | Issue | Proposed |
|---------|-------|----------|
| Creation / Input | "Input" was renamed to "Creation" but neither clearly communicates "produce something" | **Work** or **Task** |
| Review | Overlaps with autonomy-level review | **Approval** (explicit gate) |
| Decision | Special case of review with N-way branching | Keep **Decision** |
| Terminal / End | "End" is selectable in editor but shouldn't be added manually | Keep **End** (but hide from step type selector) |

The key distinction: **Approval** = explicit workflow gate with human sign-off. Autonomy-level review = agent self-governance. Different concepts, different names.

---

## Future Directions (To Park and Design)

These emerged from the discussion but are larger efforts that need separate design work:

### F1. Chat-first step editing

Instead of filling forms to configure a step, the primary interface would be a chat panel (left) + workflow/script preview (right). The user describes what the step should do, AI generates the configuration (script, prompt, parameters). Similar to Claude's artifact view. The form-based editor remains available for manual tweaking.

### F2. Git-backed workflow definitions

Workflow definitions (YAML + script files) stored on git branches. Each version is a commit/tag. Inspired by Domino's model where data scientists work with files and the platform handles versioning transparently. This would replace the current in-Firestore versioning with proper version control, enabling diffs, rollbacks, and collaborative editing.

### F3. Smart Docker image management

When a user uploads or generates a script, the platform could:
1. Run it on a default image
2. Detect missing dependencies at runtime
3. Auto-build a custom image with the required packages

For security-conscious deployments, an admin role would control which base images and packages are available. For exploratory use, the platform handles it automatically.

### F4. Role-based environment control

- **Admin**: Defines available Docker images, base environments, approved packages
- **Builder**: Creates workflows and agents using available environments
- **User**: Executes workflows, reviews outputs

This maps to the discussed security model where "even if a chat/AI session tries to create an unsafe environment, it physically doesn't have permissions to do so."

### F5. Agent output version history

Store and display all iterations of agent output within a step execution. When a step goes through multiple revise cycles, users should be able to see how the output evolved. This is particularly valuable for audit trails in regulated environments.

---

## Observations

### What works well today

- **The execution flow is solid.** The Pharmaverse governance workflow runs correctly end-to-end. The iterative generate-review-revise loop works as intended.
- **Presentation output is powerful.** The `presentation` field in agent output (HTML rendering) produces readable, professional reports. This feature was discovered by accident — it should be more prominent.
- **Step-by-step workflow building works.** Despite UX friction, a non-developer was able to build a multi-step workflow with scripts and agents. The platform's expressiveness is sufficient.
- **Autonomy levels are a compelling pitch.** "Start safe, increase trust gradually" resonates with pharma stakeholders. The concept should be preserved even as the levels are simplified.

### What causes the most friction

- **Too many concepts to juggle simultaneously.** Executor type + autonomy level + step type + plugin + skill + agent = cognitive overload. Unifying these (see C1, C2) is the highest-leverage improvement.
- **Technical details exposed to non-technical users.** Docker images, runtime selectors, and command fields are implementation details that most users shouldn't need to see.
- **Form-first editing for what should be a conversation.** The natural interaction for configuring a step is "I want this step to collect metrics from GitHub" — not filling in 8 form fields.
