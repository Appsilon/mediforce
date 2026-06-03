# LDX3 London 2026 — Hot Topics Analysis

*Data-driven thematic analysis of all 264 sessions (titles + abstracts + official topic tags). LeadDev's festival of engineering leadership, 2–3 June 2026.*

**Method:** every session's title and abstract was normalised and mined with curated keyword clusters; counts are *distinct sessions* matching a theme (a session can hit several). Logistics boilerplate (sign-up notices, "reserve your place via the LeadDev app", the repeated "no single silver bullet" Table-Talk template) was stripped before keyphrase extraction. The official `topics` taxonomy is included but it under-tags reality — only 196/264 sessions carry tags, and only 25 are tagged `ai` while **110 actually discuss it**.

---

## TL;DR — the one finding that matters

**AI is not a topic at this conference; it is the weather.** It appears in **42% of all sessions (110/264)** and saturates the senior track — **64% of the DirectorPlus zone**. But the framing has shifted decisively from *"should we adopt AI?"* to **"AI is here — now how do we lead, measure, secure, and grow people around it?"** Every classic engineering-leadership theme (productivity, careers, tech debt, reliability, hiring, culture) has been re-opened *through an AI lens*. The two headline anxieties: **(1)** what happens to engineers' skills, identity and career ladders when AI writes the code, and **(2)** how to keep quality, trust and control when output scales faster than humans can review it.

---

## 1. Official topic taxonomy (LeadDev's own tags)

| Tag | Sessions |
|---|---:|
| technical-direction | 38 |
| leadership | 32 |
| culture | 32 |
| **ai** | **25** *(undercounts — real figure is 110)* |
| software-quality | 22 |
| career-development | 19 |
| velocity | 13 |
| management | 12 |
| communication | 8 |
| hiring | 3 |
| reporting | 2 |

---

## 2. Hot topics, ranked by prevalence

Distinct sessions mentioning each theme (of 264). "Leadership" sits near-universal because it's a leadership conference — treat it as the baseline, and read everything below it as the *specific* conversation.

| # | Hot topic | Sessions | Share |
|---|---|---:|---:|
| 1 | **AI / GenAI** (the dominant cross-cutting theme) | 110 | 42% |
| 2 | Delivery / velocity / shipping | 117 | 44% |
| 3 | Reliability, incidents & resilience | 70 | 27% |
| 4 | Strategy & business alignment / influencing up | 61 | 23% |
| 5 | Scaling systems **and** orgs | 52 | 20% |
| 6 | Communication, storytelling & influence | 46 | 17% |
| 7 | Testing & quality engineering | 46 | 17% |
| 8 | Engineering culture & psychological safety | 43 | 16% |
| 9 | Cost / efficiency / FinOps | 38 | 14% |
| 10 | Career growth — IC vs management tracks, Staff+ | 36 | 14% |
| 11 | Data, observability & metrics | 26 | 10% |
| 12 | Mentoring / coaching / growing people | 25 | 9% |
| 13 | Hiring, interviewing & talent | 18 | 7% |
| 14 | Technical debt / modernization / legacy | 14 | 5% |
| 15 | Platform engineering / golden paths | 9 | 3% |

*(Security scored 32% but is inflated by the generic word "risk"; the genuine security conversation is concentrated in the AI-safety sub-theme below.)*

---

## 3. The AI deep-dive — because 42% deserves a breakdown

### AI intensity by stage
The more senior and strategic the room, the more it's about AI.

| Stage / zone | AI sessions | Share |
|---|---|---:|
| **DirectorPlus zone** (senior leaders) | 29/45 | **64%** |
| Solutions Zone (vendor/demo) | 29/59 | 49% |
| Leading your Organization | 11/27 | 41% |
| Making technical choices | 8/22 | 36% |
| Community Zone | 14/40 | 35% |
| Workshop Zone | 9/26 | 35% |
| Building for production | 8/24 | 33% |
| Connection Zone (networking) | 2/21 | 10% |

### What about AI, specifically? (share of the 110 AI sessions)

| AI sub-theme | Sessions | Share |
|---|---:|---:|
| **AI-assisted coding / dev workflow** (Copilot, Cursor, agents writing PRs) | 31 | 28% |
| **Measuring AI's impact** — productivity, DORA-and-beyond, ROI | 30 | 27% |
| **Strategy / "what does AI actually mean for us"** (incl. hype vs reality) | 27 | 25% |
| Risk, governance, trust & safe deployment | ~25 | ~23% |
| **Skills, juniors & careers in the AI era** | 19 | 17% |
| Org-wide adoption / rollout / enablement / upskilling | 19 | 17% |
| **Agents in production** — reliability, eval, observability, guardrails | 15 | 14% |
| Context / RAG / MCP / data plumbing for AI | 13 | 12% |

### The keynote stage tells the same story
9 keynotes; the headline slots are AI-or-productivity:
- **Shipping secure, reliable and high-performance AI agents** — Danai Antoniou (Gradient Labs)
- **30 to 70 PRs a day: how we managed to not wreck our systems** — Liz Fong-Jones (Honeycomb)
- **Engineering at scale: why developer experience is your competitive advantage** — Nicole Forsgren (*Accelerate* author)
- **We doubled engineering productivity at eBay, but couldn't change culture** — Randy Shoup
- **Game time: a playbook to (unsuccessfully) 10x in a week and (successfully) 10x in a year** — Plum Ertz (Ro)
- *Counter-programming / "human" keynotes:* **The story box** (Michael Lopp, on storytelling), **Things fall apart** (Sam Newman, on architecture & cascading failure), **How to grow your engineers into great leaders** (Charles Duncan, Netflix), **Look for the Helpers** (Ian Coldwater, CNCF).

### "The Big Debate" — what's openly contested
All three debate slots are AI:
1. **What will AI-accelerated engineering teams actually look like?**
2. **How will we deal with the new drudgery of AI-generated code?**
3. **What makes an effective EM in the AI era?**

### DirectorPlus roundtables — the senior-leader anxiety map
26 distinct roundtables; the AI-themed questions reveal exactly where leaders feel the ground moving:
- *Identity & people:* "Engineer identity as AI reshapes how you work", "Developing engineers in the age of AI: how to build skills when the learning pathways are disappearing", "Fairness vs performance in the age of AI".
- *Control & quality:* "Scaling delivery in the AI era: how to stay in control when velocity is no longer the constraint", "AI in production: how to maintain quality as output scales", "Testing in the age of AI", "Agent trust: where to draw the line without sacrificing velocity".
- *Risk & governance:* "AI in the SDLC: where does trust end and risk begin?", "Balancing speed and risk: how to move fast on AI without exposing the business to irreversible harm", "Observing AI in production".
- *Leadership judgment:* "The technology leader's dilemma: how to lead AI adoption without losing your judgment", "Leading engineering when AI turns delivery into R&D", "Managing up in the AI era".
- *Measurement:* "Beyond DORA: how to measure developer productivity in a way that actually drives change", "From adoption to proficiency: how to grow AI effectiveness across your org".

---

## 4. The hot topics, with anchor sessions

### 🔥 1. AI agents in production (promise → reliability)
The single hottest *technical* sub-theme. The conversation has matured past demos into reliability, evaluation, observability and security.
- **Production AI agents: the gap between promise and reality** — João Freitas (PagerDuty)
- **Shipping secure, reliable and high-performance AI agents** *(keynote)* — Danai Antoniou (Gradient Labs)
- **Your agents lack context: how to fix "You're absolutely right!"** — Dennis Pilarinos (Unblocked)
- **Most MCP servers are collecting dust. How to avoid that.** — Thomas Johnson (Multiplayer)
- **Ship 10x code safely with agents** — Mark Lechner (Docker)
- **Agentic triage for tackling technical debt** — Sam Edwards (Vercel)

### 🔥 2. Measuring AI's impact / developer productivity (beyond DORA)
Leaders have bought the tools; now they're being asked to prove ROI — and arguing about *how* to measure it.
- **The state of AI in software development: insights across 400+ organizations** — Justin Reock (DX)
- **AI productivity at enterprise scale** — Hywel Carver (Skiller Whale)
- **Engineering at scale: why developer experience is your competitive advantage** *(keynote)* — Nicole Forsgren
- **We doubled engineering productivity at eBay, but couldn't change culture** *(keynote)* — Randy Shoup
- Roundtable: **Beyond DORA: measuring developer productivity in a way that actually drives change**

### 🔥 3. Skills, juniors & engineer identity in the AI era
The most *emotionally* charged thread: if AI does the entry-level work, how do engineers learn, and what is the job now?
- **400 Tech Leads. Same problems. None of them technical.** — Anemari Fiser
- Roundtable: **Developing engineers in the age of AI: building skills when the learning pathways are disappearing**
- Roundtable: **Engineer identity as AI reshapes how you work**
- Debate: **What makes an effective EM in the AI era?**
- **Mentoring that actually changes careers** — Lenni Ojala (RELEX)

### 🔥 4. Velocity & scaling delivery without breaking things
Speed is reframed: the constraint is no longer typing code — it's review, quality and control.
- **30 to 70 PRs a day: how we managed to not wreck our systems** *(keynote)* — Liz Fong-Jones (Honeycomb)
- **The mechanics of scaling: why delivery slows as you grow** — Maryia Tarpachova (Octopus Electroverse)
- **Escaping the feature factory** — Priya Athipatla (ITV)
- Roundtable: **Scaling delivery in the AI era: staying in control when velocity is no longer the constraint**

### 🔥 5. Reliability, incidents & resilience
- **Don't wait for an outage to improve your reliability** — Leo Papaloizos (incident.io)
- **Things fall apart — architecture to avoid progressive collapse** *(keynote)* — Sam Newman
- Roundtable: **Reactive operations at scale are unsustainable: moving from firefighting to prevention**

### 🔥 6. Platform engineering & golden paths
Smaller in raw count but a clear "how we actually scaled" pattern from brand-name engineering orgs.
- **Updatable repos: Duolingo's journey to a golden path** — Max Blaze (Duolingo)
- **Dojo's leap from 90 clusters to one golden path** — Ell Sullivan (Dojo)
- **Crowdsourcing platform engineering** — Marianna Budnikova (Adobe)
- **Platform engineering for developers, architects & the rest of us (AI agents)** — Daniel Bryant (Syntasso)

### 🔥 7. Technical debt → business buy-in
Debt is consistently framed as a *communication/strategy* problem, not a coding one.
- **Quantifying technical debt to modernise critical systems** — Ejber Ozkan (ITV)
- **Telling the story of technical debt: from case study to business buy-in** *(workshop)* — Blanca Garcia Gil
- **Taming the legacy system monster** — Adam Harley (University of Sheffield)
- **Moving accessibility from debt to done at giffgaff** — Abi Harrison-Nye

### 🔥 8. Career tracks & the Staff+ / management question
- **The Staff Engineer's playbook: intellectual shift to systemic impact** — Anna Selway (Monzo)
- **What does a CTO even do?** — Dee Kitchen (Grafana Labs)
- **Up and down the management track** — Karen Lee Rigg (Just Eat Takeaway)
- **How to grow your engineers into great leaders** *(keynote)* — Charles Duncan (Netflix)

### 🔥 9. Leading up / engineering-to-business translation
A persistent thread of "communicate engineering value to the C-suite/board".
- **Translating up: engineering advocacy for the C-suite** *(workshop)* — Rob Zuber (CircleCI)
- Roundtable: **From engineering leader to business partner: influencing beyond your function**
- Roundtable: **Managing up in the AI era: closing the gap between board expectations and engineering reality**

### 🔥 10. Culture, inclusion & burnout under pressure
- **Inclusive leadership across cultures** — Christopher Egemba (Lightenet)
- Roundtable: **Building inclusive teams under pressure: maintaining culture when delivery doesn't slow down**
- Roundtable: **Leading through burnout: protecting your team's capacity when the pace doesn't slow down**

---

## 5. Reading between the lines

- **The dominant narrative arc:** *adoption → proficiency → control.* Last-era talks were "try AI"; 2026's talks are "we adopted it, output exploded, now review/quality/trust/measurement are the bottleneck, and our people are anxious."
- **The contested edge is trust & control**, not capability — "agent trust", "where does trust end and risk begin", "without losing your judgment", "irreversible harm". Nobody's debating whether agents can code; they're debating how much to let them.
- **The human counter-current is deliberate.** Against the AI tide, the program reserves marquee slots for storytelling (Lopp), growing leaders (Duncan/Netflix), and "Look for the Helpers" (Coldwater) — signalling that the *people* problems are seen as the harder, durable ones.
- **Notably quiet vs. prior years:** classic distributed-systems/microservices architecture, remote/hybrid working (only ~2%), DEI-as-standalone, and pure cloud-cost/FinOps are all comparatively muted — largely absorbed into the AI and delivery conversations.

## 6. If you only remember five phrases
1. **"Beyond DORA"** — measuring productivity is the open problem.
2. **"Velocity is no longer the constraint"** — review/quality/control is.
3. **"The learning pathways are disappearing"** — the junior-engineer crisis.
4. **"Agent trust: where to draw the line"** — autonomy vs. risk.
5. **"Adoption → proficiency"** — the maturity curve everyone's climbing.
