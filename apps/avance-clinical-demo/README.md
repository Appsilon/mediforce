# Avance clinical data transformation demo

A demonstration workflow built for Avance's evaluation of automated/semi-automated workflows
across the clinical data transformation lifecycle (**EDC → SDTM → ADaM → TFL**). It maps directly
onto the three agent use cases Avance asked to see, and reuses Mediforce's existing clinical skill
library rather than building anything bespoke for the demo.

- **Workflow definition**: [`src/avance-clinical-demo.wd.json`](src/avance-clinical-demo.wd.json)
- **Sample inputs**: [`fixtures/`](fixtures/)
- **Reused skill library**: `apps/protocol-to-tfl/plugins/protocol-to-tfl/skills/`
- **Agent image**: `mediforce-agent:protocol-to-tfl` (bundles R + `{admiral}` + `haven`)

## The three demo cases → workflow steps

| Avance's requested case | Workflow step | Skill | Status |
|---|---|---|---|
| ① Copy/organize template files from an archive into a target project structure | `scaffold-project` | `project-scaffolder` | **new** (added for this demo) |
| ② Read a spec file (Excel) → first-draft ADaM programs (R/SAS) | `generate-adam` | `spec-to-adam` | **new** (added for this demo) |
| ③ Generate a basic TFL from an ADaM dataset using a predefined template layout | `generate-tfl` | `adam-to-tlg` | **reused as-is** |

The human steps in between (`upload-archive`, `upload-sdtm`, `review-adam`) are standard
Mediforce building blocks — file-upload and human-review with an approve/revise gate.

```
upload-archive ─▶ scaffold-project ─▶ upload-sdtm ─▶ generate-adam ─▶ review-adam ─▶ generate-tfl ─▶ done
   (human)          ① agent           (human)         ② agent        (human gate)     ③ agent
```

## Running the demo

1. Trigger the `avance-clinical-demo` workflow (manual trigger).
2. **Upload** the template archive + the ADaM spec. A sample spec is in
   [`fixtures/adam-spec-sample.csv`](fixtures/adam-spec-sample.csv) (the skill also reads `.xlsx`).
3. The **scaffold** agent organizes templates into `programs/adam`, `programs/tlf`, `specs/`,
   `data/`, `output/`, `docs/` and writes a `MANIFEST.md` of what went where.
4. **Upload** SDTM datasets (CDISC pilot SDTM works out of the box via the bundled
   `pharmaversesdtm` data).
5. The **generate-adam** agent reads the spec and emits first-draft `{admiral}` R programs
   (one per dataset) plus a spec-parse report and an open-questions list for the programmer.
6. A programmer **reviews** the drafts and approves (or sends back — the agent revises).
7. The **generate-tfl** agent produces the tables/figures from the ADaM data using the predefined
   layout in [`fixtures/tlg-shell-template.md`](fixtures/tlg-shell-template.md).

---

## Answers to Avance's evaluation questions

### Which components are automated today

The **SDTM → ADaM → TFL** back half is automated today and shown live in this demo:
- ADaM derivation programming (`{admiral}` R) from a written spec — `spec-to-adam`
- TFL generation (tables/listings/figures via `gtsummary`/`gt`/`ggplot2`) — `adam-to-tlg`
- Project setup / template organization — `project-scaffolder`

Beyond the three demo cases, the same skill library (`protocol-to-tfl`) already covers
**Protocol/SAP → trial metadata** (`trial-metadata-extractor`), **metadata → mock TLG shells**
(`mock-tlg-generator`), and **ADaM → teal Shiny modules** (`adam-to-teal`, the **Tealflow**
tie-in). EDC → SDTM mapping is the one stage not yet packaged as a skill — it is the natural
near-term extension and fits the same pattern.

### Where AI-driven capabilities are leveraged / can be extended

- **Code generation**: each agent step is a Claude Code agent running in a container, reading a
  *skill* (a Markdown playbook + reference guides) and writing real R code, executing it, reading
  errors, and fixing them.
- **Orchestration**: the workflow engine sequences steps, passes files through a shared workspace,
  and inserts human review gates with approve/revise loops (autonomy level `L3`).
- **Extension points**: add a stage by adding a skill (a Markdown file) and a step in the
  workflow JSON — no platform code changes. Swap R for SAS by changing the skill's code template.

### Ease of configuring/extending agents internally — can Avance's team own it?

Yes. Two of the three demo skills (`project-scaffolder`, `spec-to-adam`) were authored **just for
this demo** by writing one Markdown `SKILL.md` each and registering a step in the workflow JSON —
no changes to platform code, no new container image. That is the whole extension surface:

- **A skill** = `SKILL.md` (instructions) + optional `references/*.md` (domain guides). Plain text.
- **A step** = one JSON object in the workflow definition pointing at the skill, the image, model,
  timeout, and autonomy level.
- **The image** = a Dockerfile listing the R/SAS packages the steps need (the demo's is 7 lines on
  top of the golden image).

Day-to-day authoring (writing skills, wiring steps, adjusting prompts/templates) is well within an
internal clinical-programming/data-science team's reach. Appsilon support is typically only needed
for platform-level work: new executor types, the initial container image with your validated
package stack, EDC-system connectors, and CI/validation integration.

### R support

**R is the default today, not a roadmap item.** The ADaM step generates `{admiral}` R; the TFL
step generates `gtsummary`/`gt`/`ggplot2` R; the teal step generates R Shiny modules. The agent
image already ships R + `{admiral}` + `haven`. SAS output is supported at skeleton level by the
same `spec-to-adam` skill (the spec parsing is identical; only the code template changes) and is
the natural place to deepen if Avance's downstream is SAS-validated.
