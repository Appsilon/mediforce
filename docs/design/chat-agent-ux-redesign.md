# Agent Team UX Redesign

**Status:** Design proposal
**Date:** 2026-03-30

## Problem

Current MediForce UX is a task queue with one-shot review. Users navigate between 5 separate pages (workflows, runs, agents, tasks, monitoring) to understand what's happening. Agent interaction is unidirectional: agent produces output → human approves/revises → done. No conversation, no real-time feedback, no ability to intervene mid-execution.

This fails because:
- **Pharma ops people open this tool 20+ times/day.** They need a cockpit, not a filing cabinet.
- **One-shot review kills iteration.** "Revise" sends the agent back to square one. No ability to say "this is 90% right, just fix the confidence interval calculation."
- **No situational awareness.** You can't see what agents are doing right now without clicking through 3 pages.
- **Agents feel like black boxes.** Users see input and output but nothing in between. In pharma, where trust is everything, this is a dealbreaker.
- **Cold start latency (2-8s per Docker spawn) makes interaction feel broken.** Chat requires <1s responses.

## Market Context

The industry is converging on a new paradigm (2025-2026):

| Pattern | Who does it | Status |
|---------|------------|--------|
| Background agents + human check-ins | GitHub Copilot, Cursor | Production |
| Progressive autonomy dial | GitHub, Notion, CrewAI | Production |
| Agent-as-team-member metaphor | CrewAI, Notion Agents | Production |
| Checkpoint-based pause/resume | LangGraph | Production |
| AG-UI protocol (agent↔frontend) | CopilotKit, AWS, Microsoft | Emerging standard |
| Warm container pooling (<300ms) | OpenAI, E2B, Cursor | Production |
| Undo as primary trust mechanism | Industry consensus | Best practice |

**Pharma is 12-18 months behind.** Veeva's clinical agents ship Aug-Dec 2026. We can be first.

## Design Principles

1. **Agents are team members, not tools.** They have names, avatars, specialties, and live status. You work *with* them, not *on* them.
2. **Always interruptible.** Any running agent can receive feedback mid-execution. The user is never locked out.
3. **Progressive disclosure of trust.** Show confidence prominently. Expose reasoning on demand. Undo everything. Let trust build through micro-interactions.
4. **One screen, not five.** The daily view is a single command center. Drill down without losing context.
5. **Speed is a feature.** Sub-second response for any interaction. Streaming for long operations.

## UX Concept: Mission Control

### Mental Model

Think of it as a team Slack channel where your AI teammates post updates, ask questions, and you can jump into any conversation at any time. But with structure — each agent's work is tied to a workflow step, has a confidence score, and follows audit rules.

### Layout: Three Panels

```
┌──────────────────────────────────────────────────────────┐
│  ◉ MediForce          Mission Control          ☀ user ▾  │
├────────────┬─────────────────────────┬───────────────────┤
│            │                         │                   │
│  TEAM      │  ACTIVITY FEED          │  DETAIL PANEL     │
│            │                         │                   │
│  ● Ada     │  ┌─────────────────┐    │  Agent: Ada       │
│    Working  │  │ Ada completed    │    │  Status: Working  │
│             │  │ risk analysis   │    │  On: SKU-2847     │
│  ● Max     │  │ ⚡ 94% conf     │    │  Confidence: 94%  │
│    Idle     │  │ [Review] [Chat] │    │                   │
│             │  └─────────────────┘    │  Reasoning:       │
│  ◐ Iris    │                         │  1. Checked...    │
│    Needs    │  ┌─────────────────┐    │  2. Found...     │
│    input    │  │ Iris needs your  │    │  3. Concluded... │
│             │  │ input on batch   │    │                   │
│  ● Rex     │  │ classification   │    │  [Approve]       │
│    Monitoring│ │ [Respond]       │    │  [Chat with Ada] │
│             │  └─────────────────┘    │  [Override]      │
│             │                         │                   │
│  ──────── │  ... more activity ...   │  History:         │
│  Workflows │                         │  • 12 runs today  │
│  Catalog   │  ┌─────────────────────┐│  • 98% approved   │
│  Settings  │  │ 💬 Type a message...││                   │
│            │  └─────────────────────┘│                   │
└────────────┴─────────────────────────┴───────────────────┘
```

### Panel 1: Team (Left Sidebar, replaces current nav)

Each registered agent shown as a team member:
- **Avatar** (color-coded by type: violet=Claude, blue=OpenCode, slate=Script)
- **Name** + specialty one-liner
- **Live status dot**: 🟢 Working / ⚪ Idle / 🟡 Needs attention / 🔴 Error
- **Current task** (if working): "Analyzing SKU-2847 risk"
- **Unread count** badge for items needing your response

Below agents: compact nav to Workflows, Catalog, Settings (secondary).

### Panel 2: Activity Feed (Center, primary interaction area)

A unified, chronological feed of everything happening:

**Event types:**
- `agent_completed` — Agent finished a task. Shows summary + confidence badge + [Review] [Chat] buttons.
- `agent_needs_input` — Agent paused, needs human decision. Shows context + [Respond] inline.
- `agent_started` — Agent picked up new work. Brief notification.
- `agent_thinking` — Streaming: agent's reasoning appears in real-time (collapsible).
- `human_completed` — You approved/revised something. Confirmation card.
- `workflow_milestone` — Workflow reached a key transition.
- `error` — Something failed. Shows error + [Retry] [Reassign].

**Key interactions directly in feed:**
- **Inline review**: Expand agent output, approve/revise without leaving.
- **Chat thread**: Click to open conversational thread with the agent (right panel transforms).
- **Quick actions**: Approve, reject, retry — one click.

**Filter/focus modes:**
- "All activity" (default)
- "Needs my attention" (filtered to pending actions)
- "Agent: Ada" (scoped to one agent)
- "Workflow: Q1 Supply Review" (scoped to one workflow)

### Panel 3: Detail / Conversation (Right, contextual)

Transforms based on what's selected:

**Mode A — Agent Detail**: Agent profile, current work, reasoning chain, confidence, history, controls (pause/stop/reassign).

**Mode B — Review**: Full agent output with tabs (Content, Data, Git), verdict form, previous step context. Same as current review but embedded.

**Mode C — Conversation**: Chat thread with the agent. User types message → agent responds with context of current/last work. This is where "90% right, just fix the CI calc" happens.

**Mode D — Workflow Overview**: Step diagram, current position, variables, audit trail.

### Scenarios

**A) Agent finishes, user iterates:**
1. Feed shows "Ada completed risk analysis" with 94% confidence badge
2. User clicks [Review] → right panel shows output in Mode B
3. User spots issue, clicks [Chat with Ada] → panel transforms to Mode C
4. User types "The confidence interval for batch 2847 should use 99% not 95%"
5. Ada responds with corrected analysis (streamed in real-time)
6. User clicks [Approve] → workflow continues

**B) User checks on running agent:**
1. Team panel shows Rex with 🟢 "Working" on "Monitoring warehouse temps"
2. User clicks Rex → right panel shows Mode A with live reasoning stream
3. User sees Rex is checking sensors one-by-one, types "Skip building C, focus on cold chain"
4. Rex acknowledges, adjusts approach

**C) Agent flags uncertainty:**
1. Feed shows "Iris needs your input on batch classification"
2. Iris's status dot turns 🟡
3. User clicks [Respond] → inline form or chat opens
4. User provides classification → Iris continues automatically

**D) User initiates work:**
1. User types in the main input: "Run a risk assessment on all Q1 batches"
2. Supervisor routes to appropriate agent (Ada)
3. Ada appears as "Working" in team panel
4. Feed shows progress as Ada works

## Trust & Control

### Confidence as First-Class UX
- Every agent output shows confidence prominently (color-coded: green >80%, amber 50-80%, red <50%)
- Confidence rationale available on hover/click
- Historical confidence accuracy tracked per agent ("Ada is right 96% of the time at >90% confidence")

### Intervention Patterns
- **Pause**: Stop agent mid-execution, review state, resume or redirect
- **Override**: Replace agent output with human input (logged in audit trail)
- **Redirect**: Change agent's approach mid-execution via chat
- **Abort**: Stop and roll back (undo)
- **Reassign**: Move work to a different agent

### The Undo Button
Every agent action has a visible undo. This is the #1 trust mechanism per industry research. In pharma context: undo an approval, retract a classification, revert a data transformation. All with full audit trail.

### Autonomy Dial
Per-agent, per-workflow setting. Visible in agent detail panel. User can adjust:
- L2 "Review everything" → L3 "Review when confidence <90%" → L4 "Fully autonomous"
- Changes logged. Can always step back.

## Technical Architecture for Speed

### Problem: Current 2-8s Cold Start Per Agent Step

Current flow: workflow step → spawn Docker container → initialize CLI → execute → parse output → cleanup.

### Solution: Warm Agent Sessions

**Phase 1 — Process Pooling (no Docker per chat):**
- Keep agent processes alive between interactions
- For chat: reuse existing Claude/LLM session, inject new message into context
- For workflow steps: reuse warm container, inject new prompt
- Target: <500ms for follow-up messages, <2s for new agent tasks

**Phase 2 — Streaming Responses:**
- SSE (Server-Sent Events) from agent process to frontend
- Agent reasoning streams in real-time (like Claude Code does)
- Partial results appear as agent works
- Uses existing `stream-json` output mode from ClaudeCodeAgentPlugin

**Phase 3 — Session Persistence (LangGraph-style):**
- Agent state checkpointed to Firestore after each interaction
- Resume from checkpoint on next message (no context rebuild)
- Enables pause/resume across browser sessions

### Real-Time Communication

```
Browser ←SSE→ Next.js API ←EventEmitter→ AgentRunner ←stdio→ Agent Process
                                              ↕
                                         Firestore (persistence)
```

- Frontend subscribes to SSE endpoint per agent run
- AgentRunner emits events as agent produces output
- Firestore stores completed interactions for persistence
- No WebSocket needed initially (SSE is simpler, sufficient for MVP)

### Warm Container Strategy

Instead of `docker run` per step:
1. Start container once when agent is "activated"
2. Keep alive with health checks (idle timeout: 10 min)
3. Inject new work via mounted volume or stdin
4. Pool of 2-4 warm containers per agent type
5. Fall back to cold start if pool exhausted

**Expected improvement:**
| Metric | Current | Target |
|--------|---------|--------|
| First message | 5-10s | <2s |
| Follow-up message | 5-10s | <500ms |
| Streaming start | N/A | <300ms |
| Agent switch | 5-10s | <1s (warm) |

## Phased Implementation

### Phase 1: MVP — Team Dashboard + Activity Feed (1-2 weeks)

**What ships:**
- New `/team` route as the home page
- Left panel: agent team members with mock live status
- Center: activity feed pulling from existing agent runs + tasks
- Right: existing review UI embedded in detail panel
- Chat input (UI only — sends as task completion comment initially)
- Beautiful, polished, $2B-startup feel

**What stays:**
- Existing routes still accessible
- Existing agent execution (Docker per step)
- Existing data models

**Data source:** Existing Firestore collections (agentRuns, humanTasks, processInstances) via real-time subscriptions.

### Phase 2: Live Interaction (2-4 weeks)

**What ships:**
- SSE streaming from agent execution
- Chat actually sends messages to running agents
- Warm container pooling (process-level, not Docker)
- Agent reasoning visible in real-time
- Pause/resume agent execution
- Inline review in feed (no right panel needed)

### Phase 3: Full Agent Team (4-8 weeks)

**What ships:**
- Supervisor layer (coded logic routing work to agents)
- Multi-agent coordination view
- User initiates work via natural language
- Autonomy dial per agent
- Undo for all agent actions
- AG-UI protocol adoption
- Historical trust metrics per agent

## Open Questions

1. **Conversation persistence**: Store chat messages as a new Firestore collection, or extend agent run events?
2. **Supervisor scope**: Start with hardcoded routing rules, or use LLM-based routing from day one?
3. **Multi-tenant agents**: Can two users chat with the same agent simultaneously? (Probably: separate sessions, same agent definition.)
4. **Compliance**: Do chat messages with agents need the same audit trail as task completions? (Probably yes in pharma.)
5. **Cost**: Chat interactions = more LLM calls. Need usage tracking per user/workflow.

## References

- [AG-UI Protocol](https://docs.ag-ui.com/introduction) — Agent-frontend communication standard
- [LangGraph Checkpointing](https://langchain-ai.github.io/langgraph/) — State persistence for agent pause/resume
- [OpenAI Container Pooling](https://openai.com/index/equip-responses-api-computer-environment/) — Warm container strategy
- [Cursor 2.0 Architecture](https://blog.bytebytego.com/p/how-cursor-serves-billions-of-ai) — Speculative edits, parallel agents
- [Veeva AI Agents](https://www.veeva.com/products/veeva-ai/) — Pharma-specific agent UX (shipping Aug-Dec 2026)
- [Cloud Security Alliance ATF](https://cloudsecurityalliance.org/blog/2026/02/02/the-agentic-trust-framework-zero-trust-governance-for-ai-agents) — Trust framework for AI agents
- [GitLab Trust Research](https://about.gitlab.com/blog/building-trust-in-agentic-tools-what-we-learned-from-our-users/) — Trust builds through micro-interactions
- [Smashing Magazine Agentic AI Patterns](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/) — UX patterns for agent oversight
