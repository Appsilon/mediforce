# MediForce Roadmap — Agent UX Redesign

_Draft based on Mission Control prototype session, March 2026_

## Phase 1: Foundation (now → 4 weeks)
_What we have + polish_

- **Mission Control MVP** — 3-panel team dashboard (sidebar, activity feed, detail panel). Prototype done, needs local testing and UI polish.
- **Agent Profile (prompt + skills + MCP)** — tabbed detail panel with system prompt, skills, mock MCP tools. Needs real backend (CRUD on definitions, actual MCP connections).
- **Project Coordinator** — Agent Manager concept works as mock. Must become a real supervisor agent (reacts to events, escalates, tracks goals).
- **E2E test infrastructure** — journey tests + GIF recording pipeline. Auth fix done. Needs stable local runs.

## Phase 2: Interaction (4-8 weeks)
_What differentiates us from everyone_

- **Chat with agents mid-execution** — "Message your team..." (currently disabled). Agent streaming via SSE, pause/resume, redirect. Core differentiation — nobody has this in pharma.
- **Claim flow** — edit agent output before it becomes official record. #1 requirement from enterprise prospect feedback. Without this, no enterprise sale.
- **Conversational onboarding** — Typeform-style workflow parameter collection (chat UI, not modal popups). First impression that says "this is not another form tool."
- **Self-reflecting agents** — agents flag low-confidence results before showing to user. Multiple prospects expect this.

## Phase 3: Trust & Compliance (8-12 weeks)
_What sells enterprise_

- **Per-study access control** — different teams see different data. Table stakes for pharma.
- **Full audit trail on chat** — every agent interaction is auditable (GxP). Confirmed as mandatory by prospects.
- **GxP validation pack** — ready-made package for procurement. Removes the biggest blocker in enterprise sales cycles.
- **Deterministic + AI steps** — not everything should be AI. Rule-based steps alongside agent steps in one workflow. Prospects explicitly asked for this.

## Phase 4: Ecosystem (12-16 weeks)
_What scales_

- **MCP integrations** — LIMS, CTMS, eTMF connections. Prospects named this as table stakes.
- **Template marketplace** — ready-to-use workflow templates (Supply Chain Risk Assessment, Safety Signal Detection). Viral loop for open source distribution.
- **Agent Builder** — describe a workflow step in plain language, agent configures it. Tiered accessibility: engineers get full control, domain experts build through guided interaction. (Inspired by Wonderful.ai's pattern.)
- **Infrastructure partnerships** — integration with Domino/cloud providers as optional compute backend. Accelerator, not dependency.

## Priority Stack (by impact)

| # | Feature | Why first |
|---|---------|-----------|
| 1 | Chat mid-execution | Core differentiation — nobody has this in pharma |
| 2 | Claim flow | #1 enterprise requirement from prospect feedback |
| 3 | Conversational onboarding | First impression, shows "this is not another form tool" |
| 4 | Per-study access control | Blocker for any enterprise pilot |
| 5 | MCP integrations | Table stakes according to prospects |

## Continuous

- **Open source community** — PHUSE/CDISC presence, white papers, contributions
- **GIF recordings** of every feature (demo-driven development)
- **Hybrid distribution** — open source wedge → internal champion → enterprise close
