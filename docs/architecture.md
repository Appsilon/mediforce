# Architecture

## Design Philosophy

Mediforce is a framework for codifying business processes as structured human + AI collaboration workflows. The core insight: processes can be decomposed into **steps**, and each step can be executed by a human, an AI agent, or the system — with configurable autonomy, escalation, and auditability.

The architecture separates **what** happens (the process) from **who** does it (the configuration). This separation is what makes processes sharable and reusable across organizations.

## Core Concepts

### Step — the atom of work

The smallest unit in a process. Defines what needs to happen, not who does it.

```
Step
├── type        — action | review | conversation
├── input       — what data this step receives
├── output      — what data this step produces
├── transitions — where to go next
└── gates       — conditions to enter this step
```

**Step types:**

| Type | Behavior | Example |
|------|----------|---------|
| Action | Execute a task, produce output | "Generate safety report", "Parse document" |
| Review | Evaluate input → approve / revise / reject | "Medical review", "Manager approval" |
| Conversation | Multi-turn dialogue until consensus | "Refine analysis with AI" |

Review steps are first-class: when a reviewer says "revise," the process automatically loops back to the producing step. This handles the most common workflow pattern in regulated environments — iterative review and approval.

### Process — a directed graph of steps

A process template: reusable, sharable, open-sourceable. Defines the step graph, the data model, and the UI — but says nothing about who executes each step.

```
Process
├── Trigger     — what starts an instance (form, schedule, event, manual)
├── Steps       — directed graph with branching and loops
├── Entities    — data model specific to this process
└── Views       — UI pages composed from shared primitives
```

### Process Config — who does what

Per-organization configuration that maps steps to executors. The same process template, deployed with different configs, produces different behaviors:

```
Clinical Monitoring @ Large Pharma:
  "Safety Review"  → agent, L3 (drafts, human approves)
  "Final Sign-off" → human (always)

Clinical Monitoring @ Small Biotech:
  "Safety Review"  → agent, L4 (autonomous, human reviews after)
  "Final Sign-off" → human (always)
```

### Agent Autonomy Levels

The central mechanism for human-agent collaboration. Each agent participating in a step has a configured autonomy level:

| Level | Name | Agent behavior | Process behavior |
|-------|------|---------------|-----------------|
| **L1** | Observer | Watches, reports insights | Process doesn't wait. Agent output is informational. |
| **L2** | Advisor | Suggests action to human | Process waits for human. Agent provides recommendations. |
| **L3** | Drafter | Executes work, submits for approval | Process waits for human approval. If uncertain → escalates. |
| **L4** | Executor | Acts autonomously | Process continues. If uncertain → configurable fallback. |

Key design choice: **agents at any level can signal uncertainty and escalate to a human.** This isn't a failure mode — it's how the system maintains safety. An L4 agent that escalates is working correctly.

Fallback behavior when an agent is uncertain is configurable per step:
- **Escalate to human** — pause and wait for human input
- **Continue with flag** — proceed but mark the output for review
- **Pause** — stop the process instance until someone intervenes

## Separation of Concerns

```
┌─────────────────────────────────────────────────────┐
│                    PROCESS                           │
│              (template — reusable)                   │
│                                                      │
│  Trigger → Step → Step → Review ─loop─→ Step         │
│                                                      │
│  Defines: WHAT happens, in what order,               │
│           with what data, under what conditions      │
└─────────────────────────────────────────────────────┘
                        ×
┌─────────────────────────────────────────────────────┐
│               PROCESS CONFIG                         │
│           (per org — customizable)                   │
│                                                      │
│  Step "Review"    → agent("reviewer"), L3            │
│  Step "Approve"   → human("manager")                 │
│  Step "Generate"  → agent("analyzer"), L4            │
│                                                      │
│  Defines: WHO does each step, with what              │
│           autonomy, what fallback behavior            │
└─────────────────────────────────────────────────────┘
                        ×
┌─────────────────────────────────────────────────────┐
│                   AGENTS                             │
│          (reusable across processes)                 │
│                                                      │
│  Plugin-based architecture                           │
│  Same agent can participate in multiple processes    │
│  Configurable per deployment                         │
│                                                      │
│  Defines: reusable AI executors that can be          │
│           assigned to any step in any process         │
└─────────────────────────────────────────────────────┘
```

## Platform Components

What the platform provides (shared across all processes):

| Component | Responsibility |
|-----------|---------------|
| **Workflow Engine** | Executes step graphs — transitions, gates, review loops, triggers |
| **Agent Runtime** | Invokes agents, manages autonomy levels, handles escalation |
| **Plugin System** | Modular agent capabilities — add domain logic without touching the runtime |
| **Entity Layer** | Data model, schema validation, real-time updates |
| **Auth & Roles** | Role-based access, permission checks per step |
| **Audit Trail** | Records every step execution, every agent action, every human decision |
| **UI Primitives** | Shared React components — data tables, KPI cards, review panels, timelines |

What each process provides (custom per domain):

| Component | Responsibility |
|-----------|---------------|
| **Entity schemas** | Data model for this specific process |
| **Step definitions** | The step graph — what happens, in what order |
| **Business rules** | Gates, validation, quality checks, compliance logic |
| **Views** | UI pages composed from platform primitives |
| **Agent plugins** | Domain-specific agent capabilities |

## Runtime Lifecycle

```
1. Trigger fires (form / schedule / event / manual)
                    │
2. Process Instance created, work item initialized
                    │
3. For each step in the graph:
   a. Check gates — if not met, pause
   b. Look up executor config for this step
   c. Route to executor:
      ├── System → execute automatically
      ├── Human  → show in UI, wait for action
      └── Agent  → invoke with autonomy level:
            ├── L1: run, attach output, don't wait
            ├── L2: run, show suggestion, wait for human
            ├── L3: run, show for approval, wait for human
            └── L4: run, use output directly
                    if uncertain → check fallback config
   d. Record execution in audit trail
   e. Evaluate transitions → move to next step(s)
                    │
4. Process reaches terminal step → complete
```

## Design Decisions

- **Code-first, not low-code.** Good APIs and documentation. AI coding assistants serve as the "interface builder" for people who prefer visual configuration.
- **Bottom-up generalization.** Build concrete processes, extract patterns, don't over-abstract early. Every abstraction in the platform earned its place by being needed in multiple real processes.
- **TypeScript throughout.** Type safety, developer experience, and excellent tooling for AI-assisted development.
- **Schema per process.** Each process defines its own data model. No generic entity system — clarity over flexibility.
- **Agents as plugins.** Domain logic lives in plugins, not in the runtime. Adding a new type of agent doesn't require changing the platform.

## Validated Against Multiple Domains

The architecture has been validated against processes in:
- **Clinical monitoring** — safety reviews, data quality checks, narrative summaries (working PoC)
- **Supply chain** — risk detection, inventory optimization (early exploration)

The goal is an architecture that handles diverse process types without requiring exceptions or workarounds.
