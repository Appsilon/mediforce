# Changelog

All notable changes to Mediforce are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-09-28

### Added

- **Join Links:** Invite a whole room with one link, or show it as a QR code on a slide. Whoever opens it confirms their email and joins the workspace as a member. The link on its own never signs anyone in ([#1329](https://github.com/Appsilon/mediforce/pull/1329), [#1354](https://github.com/Appsilon/mediforce/pull/1354)).
- **Standing Instructions:** Tell the AI Assistant how you like workflows built in a workspace, and it follows those conventions on every turn ([#1362](https://github.com/Appsilon/mediforce/pull/1362)).
- **Workflows Carry Their Own Files:** Scripts, Dockerfiles and skills live inside the workflow, alongside its input contract and notification settings, so a workflow no longer needs a checkout on the server ([#1336](https://github.com/Appsilon/mediforce/pull/1336), [#1337](https://github.com/Appsilon/mediforce/pull/1337)).
- **An Assistant That Plans First:** The AI Assistant states its plan before it builds, pushes back on designs that don't need an agent, and can set up the agents and tools a workflow needs on your behalf ([#1338](https://github.com/Appsilon/mediforce/pull/1338), [#1339](https://github.com/Appsilon/mediforce/pull/1339), [#1340](https://github.com/Appsilon/mediforce/pull/1340)).
- **Guide:** A step-by-step walkthrough of whatever page you're on, from the Guide button in the top bar ([#1387](https://github.com/Appsilon/mediforce/pull/1387)).
- **Demo:** Three narrated scenarios, building a workflow, running it and deciding on it, played over the real app ([#1402](https://github.com/Appsilon/mediforce/pull/1402)).
- **Registry Images:** Pull an image from Docker Hub or GitHub's registry straight from **Workspace → Images**. New workspaces start with the five default step images already catalogued ([#1372](https://github.com/Appsilon/mediforce/pull/1372), [#1379](https://github.com/Appsilon/mediforce/pull/1379)).

### Changed

- **Live Logs:** Step logs stream as they happen instead of arriving when the step ends, and the audit trail marks which entries deserve your attention ([#1383](https://github.com/Appsilon/mediforce/pull/1383)).
- **Ticket Button:** The Search badge in the header is now a Ticket button that opens straight on a new ticket ([#1331](https://github.com/Appsilon/mediforce/pull/1331)).
- **Faster Image Cards:** Image capabilities are checked in the background instead of when you expand a card ([#1391](https://github.com/Appsilon/mediforce/pull/1391)).

### Fixed

- An image a live workflow depends on can no longer be deleted out from under it ([#1378](https://github.com/Appsilon/mediforce/pull/1378)).
- Agent steps no longer stall when the queue is under load ([#1371](https://github.com/Appsilon/mediforce/pull/1371), [#1385](https://github.com/Appsilon/mediforce/pull/1385)).
- A public repository given as an SSH address now works without a deploy key ([#1388](https://github.com/Appsilon/mediforce/pull/1388)).
- Coloured borders across the app no longer render grey ([#1382](https://github.com/Appsilon/mediforce/pull/1382)).
- The workflow editor no longer drops fields it didn't touch when you save, and pasting a workflow into the source editor works again ([#1325](https://github.com/Appsilon/mediforce/pull/1325), [#1335](https://github.com/Appsilon/mediforce/pull/1335)).

## [1.1.0] - 2026-09-04

### Added

- **Roles That Enforce:** The roles on a human step now decide who can claim and complete it. Before this release they were shown in the editor but checked by nothing ([#1275](https://github.com/Appsilon/mediforce/pull/1275)).
- **Access Tab:** Each workflow has its own run and edit roles, and the tab shows who actually holds each one, so a role nobody holds is flagged instead of discovered as a wall ([#1279](https://github.com/Appsilon/mediforce/pull/1279)).
- **Roles In Settings:** Grant roles from **Workspace settings → Members**, workspace-wide or for a single workflow, without the CLI ([#1274](https://github.com/Appsilon/mediforce/pull/1274)).
- **Built-In Roles:** Every deployment ships with `editor`, `executor`, `reviewer` and `workflow-manager`. A new workflow starts with sensible defaults, and a workspace can never lock itself out of its own workflow ([#1290](https://github.com/Appsilon/mediforce/pull/1290)).
- **Auto-Join By Domain:** Set `AUTO_JOIN_WORKSPACES` and everyone at your company's email domain joins a shared workspace without an invite ([#1288](https://github.com/Appsilon/mediforce/pull/1288)).
- **Pick Agents And Models:** Choose agents and models from a list instead of typing their IDs ([#1310](https://github.com/Appsilon/mediforce/pull/1310)).

### Changed

- **Role Picker:** Roles on a step are picked from a list instead of typed, and naming a role nobody holds warns you before you save ([#1277](https://github.com/Appsilon/mediforce/pull/1277)).
- **Your Work, Found:** Human actions can be filtered to one workspace, several, or all of them ([#1278](https://github.com/Appsilon/mediforce/pull/1278)).
- **Every Path On The Canvas:** Every branch of a decision shows at once, and inserting a step on an edge no longer piles the rest of the path on top of it ([#1316](https://github.com/Appsilon/mediforce/pull/1316)).
- **Version On The Card:** Workflow cards show which version **Start Run** will start ([#1307](https://github.com/Appsilon/mediforce/pull/1307)).
- **Secrets Tab:** Lists the keys a workflow is missing instead of showing an empty form ([#1321](https://github.com/Appsilon/mediforce/pull/1321)).
- **Upgrading:** Role defaults apply to workflows registered after you upgrade. Existing workflows stay open to every workspace member until someone restricts them ([#1290](https://github.com/Appsilon/mediforce/pull/1290)).

## [1.0.0] - 2026-08-26

### Added

- **Control Modes Per Step:** Decide how much each step leaves to AI: No agent, Assist, Cowork, Human review or Autonomous agent ([#783](https://github.com/Appsilon/mediforce/pull/783)).
- **AI-Assisted Workflow Building:** Describe a process in plain language and the workflow assistant builds or changes the steps, with every change reviewed before it's saved ([#921](https://github.com/Appsilon/mediforce/pull/921)).
- **Canvas Editor:** Build a workflow on a full-width canvas. Add, insert, reorder and delete steps on the diagram itself, with undo and redo ([#825](https://github.com/Appsilon/mediforce/pull/825), [#918](https://github.com/Appsilon/mediforce/pull/918)).
- **Ready-Made Blocks:** Start from blocks that already work, such as Send email, Call an API, Route by condition and Wait ([#1231](https://github.com/Appsilon/mediforce/pull/1231), [#542](https://github.com/Appsilon/mediforce/pull/542)).
- **Review Steps With Real Choices:** A human step offers its own verdicts, such as approve, request changes or escalate, and each one sends the workflow somewhere different ([#396](https://github.com/Appsilon/mediforce/pull/396)).
- **Richer Human Tasks:** A human step can collect edits in a table, take parameters alongside its verdict, or go straight to a named person ([#514](https://github.com/Appsilon/mediforce/pull/514), [#658](https://github.com/Appsilon/mediforce/pull/658), [#554](https://github.com/Appsilon/mediforce/pull/554)).
- **Models And Costs Per Step:** Bring your own API key, pick the model for each step, and see what every run and every step cost ([#348](https://github.com/Appsilon/mediforce/pull/348)).
- **Credit Per Workspace:** Each workspace sees its own OpenRouter balance, in the app or with `mediforce system credits` ([#349](https://github.com/Appsilon/mediforce/pull/349)).
- **Checks Before You Run:** Before a run starts, Mediforce flags missing images and secrets, unknown models with a suggested fix, and low credit, and says how to resolve each one ([#709](https://github.com/Appsilon/mediforce/pull/709), [#734](https://github.com/Appsilon/mediforce/pull/734)).
- **Audit Trails:** Inputs, outputs, models, workflow versions, roles and approvals are captured for every run without extra work.
- **Locked Versions:** An activated workflow version can't change, so every run traces back to the exact definition that produced it. Dry runs test approval gates and logic before any study data is involved ([#678](https://github.com/Appsilon/mediforce/pull/678)).
- **Output Files:** Everything a step produces stays with the run. Preview reports and Markdown in the browser, go fullscreen for large ones, or download them all at once ([#672](https://github.com/Appsilon/mediforce/pull/672), [#863](https://github.com/Appsilon/mediforce/pull/863), [#1006](https://github.com/Appsilon/mediforce/pull/1006), [#826](https://github.com/Appsilon/mediforce/pull/826), [#476](https://github.com/Appsilon/mediforce/pull/476)).
- **Your Task Table:** Pending work shows as one table with bulk cancel, and whoever is assigned a task can be notified ([#699](https://github.com/Appsilon/mediforce/pull/699), [#827](https://github.com/Appsilon/mediforce/pull/827)).
- **Monitoring:** One page for workflows, agents, users and tasks across the workspace ([#1118](https://github.com/Appsilon/mediforce/pull/1118)).
- **Roles, Secrets And Isolation:** Control who can use a workflow, limit credentials to the workflows that need them, and run agents in isolated containers ([#346](https://github.com/Appsilon/mediforce/pull/346), [#71](https://github.com/Appsilon/mediforce/pull/71)).
- **Triggers And Integrations:** Start workflows by hand, on a schedule or from a webhook, connect MCP tools with permissions per step, and run it all from the CLI or CI ([#1009](https://github.com/Appsilon/mediforce/pull/1009), [#236](https://github.com/Appsilon/mediforce/pull/236)).
- **Portable Triggers:** Export a workflow's triggers from one instance and import them into another ([#1076](https://github.com/Appsilon/mediforce/pull/1076)).
- **Databricks Jobs:** A step can start an existing Databricks job and route on what it returns ([#681](https://github.com/Appsilon/mediforce/pull/681)).
- **Import Workflows:** Start an empty workspace from example workflows, or import from a Git repository with the commit it came from recorded ([#1202](https://github.com/Appsilon/mediforce/pull/1202), [#689](https://github.com/Appsilon/mediforce/pull/689)).
- **Share And Move Workflows:** Share a workflow publicly by link, or move it to another workspace ([#346](https://github.com/Appsilon/mediforce/pull/346), [#359](https://github.com/Appsilon/mediforce/pull/359), [#370](https://github.com/Appsilon/mediforce/pull/370)).
- **Sign-In Your Way:** Google, email and password, or magic links. Invited people get a one-time activation link by email ([#1019](https://github.com/Appsilon/mediforce/pull/1019)).
- **Workspace Branding:** Organizations set their own logo and colours ([#941](https://github.com/Appsilon/mediforce/pull/941)).
- **Your Own Mail Server:** Send email through your own SMTP server instead of Mailgun ([#753](https://github.com/Appsilon/mediforce/pull/753)).
- **Run It Yourself:** Everything runs on Docker Compose with Postgres, with no Firebase project or hosted account to set up ([Docs](https://mediforce.ai/docs/install/)).
