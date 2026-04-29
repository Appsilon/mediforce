# AI Landing Zone

**Autonomous ingest workflow for clinical trial data deliveries.** An AI agent watches the CRO SFTP, validates every delivery against CDISC standards, and escalates only when human judgment is needed — with the audit trail built in from the first poll.

---

## The problem

Clinical trial data flows from CROs to sponsors over SFTP. Every delivery is a small crisis:

- A data manager has to download the files, run CDISC validation, sift through hundreds of findings, and decide if the package is safe to pass downstream.
- When something is broken — wrong format, missing domains, inconsistent values — the manager writes a back-and-forth email to the CRO, waits, retries.
- Analytics teams build dashboards on top of data that was waved through under deadline pressure.
- Audit trails are reconstructed weeks later for the regulator, not built up as the work happens.

The cost: bad data reaches downstream pipelines, regulatory submissions slip, and the most expensive people in the org spend their week on file triage.

## The solution

The AI Landing Zone is an autonomous workflow that takes ingest off the data manager's plate and hands them only the decisions that actually need a human.

- **The agent watches.** A cron-driven workflow polls the CRO SFTP, diffs against the previous run's listing, and downloads new files only when something has changed.
- **The agent validates.** Every delivery runs through the CDISC CORE rules engine. Findings are categorised by severity, mapped to the regulatory standard the study targets (FDA, PMDA, EMA), and turned into a one-page HTML report.
- **The human decides.** The data manager sees the report inline, accepts (with optional waivers), or rejects.
- **The agent escalates for them.** On reject, an agent drafts a rejection note to the CRO — factual, bounded, in the operator's tone — ready to be forwarded.
- **The audit trail writes itself.** Every step in every run is a git commit on a per-delivery branch. `git log` is the audit record; no separate logging system to keep in sync.

## What the data manager sees

1. An email or task notification: "delivery from CRO X arrived, 5 findings, classification: needs review"
2. A link to the run's report (HTML) — severity heatmap, top findings, the script's own status banner if validation crashed
3. Two buttons: **Accept** or **Reject**
4. If reject: a markdown note is waiting in the next task — copy, paste into email, send

The work that used to take an afternoon takes a click and a copy-paste.

## What the operator gets out of the box

- **CDISC standards coverage** — Structure, Controlled Terminology, Consistency, FDA / PMDA business rules, severity Critical / Major / Minor / Warning
- **Cleaning rules as PRs** — when a delivery has a fixable mismatch (`NY` vs `New York` vs `new york` in site IDs), the agent generates a deterministic mapping rule and opens a pull request against the study's config repo for the data manager to review (v0.2)
- **Medical screening** — a second agent skims the data for clinical anomalies using PubMed-grounded reasoning, time-boxed so a slow medical team never blocks ingest (v0.4)
- **Trial-phase-aware routing** — recommendations adapt to where the study is (recruitment vs closeout vs urgent) so the workflow doesn't loop pointlessly when there's no time (v0.5)
- **Audit by design** — per-run git branch, per-step commits, no add-on instrumentation. The branch is the audit.

## How it fits

Built on top of [Mediforce](../../README.md), our workflow + agent orchestration platform for pharma. Plugs into existing CRO / sponsor infrastructure:

- **In:** any SFTP endpoint (CRO standard) plus a study config in git that declares contract, schedule, expected files
- **Out:** a local data lake by default; GCS / S3 / Veeva Vault when production needs it
- **Glue:** Claude Code agents for the human-judgment moments, Python scripts for the deterministic ones, CDISC CORE for the standard validation
- **Configurable autonomy** — start in L1 (every decision approved), dial up to L3 (periodic review) once the team trusts the agent's judgment on a given CRO

## Status

**v0.1 — demo.** Single study (CDISC Pilot 3, Xanomeline TTS for Alzheimer's Disease), mock SFTP via Docker, local data lake. Designed to be wired up against a real CRO endpoint with config changes only.

**Roadmap.** v0.2 cleaning rules PR path. v0.3 missing-data detection + CRO escalation emails. v0.4 medical screening with PubMed. v0.5 dynamic action router + multi-study overview dashboard. v0.6 production cloud storage and real SFTP.

See [`README.md`](README.md) for the technical walkthrough and [`FUTURE.md`](FUTURE.md) for the full roadmap.

---

## One-liner for the landing page

> "Your CRO sends data. Our agent reads it, validates it, and tells your data manager what to do — only when there's a real decision to make."
