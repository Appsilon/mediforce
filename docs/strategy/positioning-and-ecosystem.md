# MediForce Positioning & Ecosystem Strategy

_Internal strategy memo — March 2026_

## Core Positioning

**MediForce solves a UX + validation problem, not an infrastructure problem.**

We build the trust layer between pharma teams and AI agents: the interface where humans oversee, direct, and collaborate with autonomous systems in regulated environments. We don't build compute platforms, model hosting, or ML training pipelines. We leverage best-of-breed tools for infrastructure and focus on what actually matters in pharma: _Can I trust this? Can I prove it? Can I control it?_

This is not "just a UI." It's the difference between a raw Kubernetes cluster and Vercel — same infrastructure underneath, completely different value proposition. Pharma teams don't need another infrastructure platform. They need a way to work with AI agents that meets their regulatory, quality, and workflow requirements.

## What We Build vs What We Leverage

| Ours (core value) | Leveraged (infrastructure) |
|---|---|
| Agent team UX (Mission Control) | Compute/MLOps (Docker, cloud providers, Domino) |
| Progressive autonomy (L0-L4) | Model providers (Anthropic, OpenAI via OpenRouter) |
| GxP-compliant audit trails | Observability (Pydantic Logfire, LangSmith) |
| Claim flow (edit before official) | Prompt optimization (DSPy) |
| Per-study access control | Agent protocols (MCP, AG-UI) |
| Conversational agent interaction | Agent frameworks (LangGraph, CrewAI — optional) |
| Workflow orchestration for pharma | Container orchestration (Docker, K8s) |
| Reproducibility & validation packs | Storage (Firebase, Postgres, S3) |
| Human-in-the-loop escalation | CI/CD, DevOps tooling |
| Pharma domain templates (SDTM, ADaM) | — |

**Rule of thumb**: If it exists as a good open-source or commercial tool, we integrate it. If it requires pharma-specific UX, trust, or regulatory knowledge, we build it.

## Competitive Landscape

We don't compete across the full stack. We compete at the **application layer** — the part users actually touch.

### Infrastructure layer — PARTNERS
_Domino Data Lab, AWS SageMaker, GCP Vertex AI_

These platforms provide compute, governance, and MLOps. Domino is particularly relevant: 6 of top 10 pharma companies, GxP-compliant Flows, SCE Coalition. But their UX is engineer-oriented (self-described as "clunky"), no human-in-the-loop, no progressive autonomy, no conversational interaction.

**Relationship**: MediForce sits on top. They provide compute muscle; we provide the pharma UX and trust layer. Not dependent on any single provider — works with Docker locally, any cloud, or Domino.

**Partnership economics**: We don't sell compute, they don't sell UX. Different revenue pools. Analogy: Figma on AWS — AWS doesn't capture Figma's value. Key risk: they could move up-stack, but building great pharma UX is years of domain work and not their DNA.

### Framework layer — WE USE THESE
_CrewAI, LangGraph, AutoGen, DSPy_

Developer frameworks for building agent systems. Powerful but raw — no UI, no compliance, no pharma awareness. These are potential building blocks inside MediForce, not competitors.

### Application layer — WHERE WE COMPETE
_Veeva (clinical agents, Aug-Dec 2026), custom pharma solutions_

Veeva is the real competitor. Established pharma vendor, massive distribution, but: slow (agents shipping late 2026), expensive, locked ecosystem, historically poor UX innovation. Our window: 6-12 months to establish position before they ship.

Custom internal solutions are the other "competitor" — pharma IT teams building ad-hoc agent tools. We win by being faster to deploy and already validated.

### Horizontal AI platforms — UX INSPIRATION
_Wonderful ($2B, conversational AI), Dust.tt, Glean_

Different domains entirely. Wonderful's Agent Builder (AI that builds agents) and skills-based composition are interesting UX patterns. Not competitors — reference points for what "good" looks like.

## Distribution Strategy

### Hybrid: Open Source Wedge + Top-Down Close

Pure PLG doesn't work in pharma (too regulated). Pure enterprise sales is too slow/expensive without references. The hybrid:

**1. ATTRACT (bottom-up)**
Open source on GitHub. A biostatistician or data scientist finds MediForce, runs it locally, builds a POC in a day. Template workflows ("Supply Chain Risk Assessment") make this instant. This creates an internal champion.

**2. EXPAND (middle-out)**
Champion demos results internally. VP Clinical Ops sees value. "Can we use this for the Phase III trial?" The open source version proves the concept with zero procurement risk.

**3. CLOSE (top-down)**
Enterprise tier: SSO, advanced audit trails, support SLA, validation packs. Procurement, MSA, pilot → 6-figure contract.

**Key enablers**:
- Template workflows as viral loop (clone, run, value in 10 minutes)
- PHUSE/CDISC community presence (talks, white papers, contributions)
- SOC2 + GxP validation pack ready (removes procurement blockers)
- Infrastructure partnerships as channel accelerators (e.g., listed in partner ecosystem)

## Open Source + Revenue Model

```
Open Source (core)
├── Workflow engine, agent orchestration, basic UI
├── Community templates, MCP integrations
├── Single-tenant deployment
└── Purpose: distribution, credibility, community

Enterprise (revenue)
├── SSO / SAML, advanced RBAC, per-study isolation
├── GxP validation pack, 21 CFR Part 11 compliance toolkit
├── Premium support + SLA
├── Advanced analytics, cost tracking
├── Managed cloud deployment
└── Purpose: monetization (6-7 figure contracts)
```

**Why this works in pharma**: Pharma WANTS to pay for validated, supported software. Open source gets you in the door; enterprise tier is what they actually budget for. The procurement team _prefers_ a commercial relationship with SLA over unsupported open source.

**Partnership dynamics**: Infrastructure partners (Domino et al.) benefit from recommending us — we give them a "UX story" for their pharma customers. Open source reduces their risk in recommending us. They don't capture our revenue because we monetize a different layer.

## Risks

### Real risks
- **Infrastructure partners move up-stack**: Domino or cloud providers could build a pharma UX layer. Mitigation: our pharma domain expertise + UX quality is hard to replicate quickly. Open source community creates switching costs.
- **Veeva ships good enough agents**: If Veeva's clinical agents are 70% as good with 100% of distribution, we lose. Mitigation: ship first, be better, win on UX and flexibility. Veeva's locked ecosystem is our opening.
- **"Just a UI" perception**: Buyers might undervalue the UX/trust layer. Mitigation: position as "validation + orchestration platform," not "UI for agents." The audit trails, compliance, and workflow engine are substantial.
- **Open source sustainability**: Community expects free; enterprise sales are slow. Mitigation: template marketplace, professional services, infrastructure partnership revenue sharing.

### Manageable risks
- **Model provider dependency**: Mitigated by model-agnostic architecture (OpenRouter)
- **Regulatory changes**: Actually helps us — more regulation = more need for validated tools
- **Tech stack churn**: Next.js/Firebase are stable enough; core logic is framework-independent

### Not real risks
- **"Someone will copy us"**: Open source means they can, but community + pharma domain knowledge + speed of iteration > copying
- **"Pharma won't adopt AI"**: Already happening — question is how, not if

## Why This Wins

Three things are true simultaneously in pharma right now:

1. **AI agents work well enough** — LLMs can genuinely do clinical data review, risk scoring, regulatory analysis
2. **Pharma can't use them** — no trust layer, no compliance, no workflow integration, no progressive autonomy
3. **Nobody is building the bridge** — infra players build for data scientists, app players (Veeva) are slow, framework players have no UI

MediForce is the bridge. We don't need to be the best AI platform. We need to be the best way for pharma teams to work with AI agents they can trust. That's a UX + validation problem, and that's exactly what we solve.
