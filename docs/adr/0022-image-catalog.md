---
status: finalized
audience: engineers
last_reviewed: 2026-09-10
---

# ADR-0022: The Image Catalog is an image the platform offers, keyed on its source

**Date:** 2026-09-02
**Deciders:** Krystian Zieliński
**Epic:** [#1292](https://github.com/Appsilon/mediforce/issues/1292) — Step Image Catalog

**All seven decisions are built.** #1294 landed `image_catalog_entries`, the
source-derived key, the required `intent`, `unknown` as a state, the
workspace-member write gate, the handlers, the contract, the route adapters and
`mediforce images`; #1295 landed probed capabilities; #1296 landed lineage — the
base computed from `RootFS.Layers` prefix containment, the layer delta cut at
that boundary, and the label delta; #1297 landed the **Images** view at
`/[handle]/images`, non-admin, grouped by base, searchable across intent and
capabilities, with the source ladder and the cross-link from Admin →
Infrastructure; #1298 pointed the step-editor picker at the catalog, which is
where decision 5 stops being a claim about a future control and starts being the
behaviour of the one authors use. Decision 7 landed after the first workspace
ran a build-mode workflow and found the image it had just built missing from
its own catalog.

#1344 later added a way to *produce* a version — `mediforce images build` and a
**Build** action — without changing any of the seven decisions: it reuses
`deriveBuildTag`, the existing builder and the existing provenance labels, so a
build it triggers is indistinguishable from a step's and is picked up by
decisions 1 and 7 with no code of its own. It does extend decision 3's write
gate from "any member may describe an entry" to "any member may also build one
of its versions", on the ground that the same member can already trigger the
same build on the same host by running a build-mode step — so the gate would
have removed the convenient path and not the capability. Whether host-side
builds should be privileged at all is a question about build-mode steps, and
this ADR does not answer it.

An entry's **source became editable** after the Images view shipped without any
way to change one: an entry added through **Add image** was final, so a mistyped
repository was permanent. This does not weaken decision 1 — it follows from
it. The id still derives from the source, so `PATCH`ing a source **re-keys** the
entry: the row is written under the id the new source derives and the old row is
removed, and a source that only spells the same key differently canonicalises to
the same id and stays put. What makes this safe is the same property that makes
deleting safe, stated under decision 3: no Workflow Definition references an
entry. Re-keying onto a source another entry already describes is refused rather
than upserted, since that would overwrite the occupant's sentence and delete the
row being edited. A re-key audits against both ids — it is the one update that
leaves an id with no row.

**Deleting an entry may now take its images with it**, which splits decision
3's write gate rather than widening it. The entry half stays a member's right
for the reason stated there — it removes an offer, and no Workflow Definition
references an entry. The image half is a different act on a deployment-wide
daemon, so it requires **admin of the workspace whose catalog it is** and keeps
the `_system` audit **Admin → Infrastructure** already used, and it is opt-in:
absent means no. It does *not* simply inherit
`assertCallerCanAdminDockerImages`, whose own comment calls it a loose
approximation until #376 — owner or admin of *any* namespace, which nearly
every user satisfies through a personal workspace. That gate still applies
underneath, so Infrastructure is unchanged; this one is additional and is what
the dialog's checkbox actually reflects.
Images are deleted by tag rather than by image id, so an artifact a second tag
still references survives instead of needing a force that would destroy a
version another entry offers; and they go before the row, all or nothing, since
the entry is the only handle anyone has on a version left behind.

Decision 7 is dated 2026-09-08 and revises one line of the original
consequences — *"a new row appears only when someone catalogues a source nobody
has catalogued before"*. That stays true of **rows**; it is no longer true of
what the catalog shows.

One piece of decision 4 is deliberately absent: a version's Dockerfile is
reached by permalink, never rendered inline. That needs #1286, which is still
open, so the view states which rung of the source ladder it reached instead of
pretending to the one below it.

## Context

Mediforce had no object meaning *"an image the platform offers for steps"*. It
had only the one meaning *"an image the daemon happens to have"*, and that was
what the step editor showed an author: an `agentImageOptions` helper in
[step-editor.tsx](../../packages/platform-ui/src/components/workflows/workflow-editor/step-editor.tsx)
mapped `docker images` into a `<select>`. Every daemon row was an option —
`postgres`, `redis`, dangling `<none>` layers, whatever ops pulled last week.
The only intelligence in the list was a string compare against
[`DEFAULT_AGENT_IMAGE`](../../packages/platform-core/src/utils/container-defaults.ts)
that put a `★` on `mediforce-golden-image`. #1298 deleted both.

Three consequences. The first two are user reports; the third is in the source.

**The rows carry nothing to read.** A build-mode step that omits `image` gets a
tag derived from its build inputs by
[`deriveBuildTag`](../../packages/agent-runtime/src/plugins/container-plugin.ts) —
`mediforce-built:<12 hex of sha256(repo \0 commit \0 dockerfile)>` — which is
the shape the schema documents and encourages. The builder labels what it makes
(`mediforce.build.commit`), and the listing never asks for it:
`DockerImageInfoSchema` is `repository`, `tag`, `id`, `size`, `created`, five
strings. *"The list of images is long and never describes what is inside."*

**The list grows one opaque row per pin bump.** The commit is folded into the
derived tag, so changing a `COPY`d script mints a new top-level row and nothing
retires its predecessor. *"We create images from dockerfile+repo+commit, which
creates a lot of very similar images and that's messy."*

**Suitability is prose.** [`docker-image-setup.md`](../guides/docker-image-setup.md)
has a table saying an agent step needs an agent CLI and a shell. Nothing
enforces it. Point an agent step at `alpine` and it type-checks, saves,
registers, and dies at container start with `exec: "claude": executable file
not found in $PATH`. The picker offered `alpine`.

The tempting fix — add columns to the daemon listing and a search box to
Admin → Infrastructure (`packages/platform-ui/src/app/(app)/[handle]/admin/infrastructure/page.tsx`) —
does not work, and the reason is the whole of this ADR: **the rows are the
wrong set.** Enriching a list of everything the daemon holds produces a
better-labelled list of everything the daemon holds, in an admin-gated section,
while the person asking *"which image do I pick for this step?"* is an author
in the step editor. The missing thing is not metadata on the rows. It is an
object.

That object has a precedent in this codebase. Golden rules
[§7](../reference/workflow-authoring-golden-rules.md#7-make-mcps-governable) says installing an MCP
executable in Docker makes it runnable but not *"visible, reviewable, scoped, or
auditable"*, and puts a **Tool Catalog** entry between "the binary exists" and
"a step can select it". Building an image makes it runnable. It does not make
it selectable.

## Decision

Introduce the **Image Catalog entry**: one image the platform offers for steps,
described by facts the platform derives and one sentence a human writes.

### 1. An entry is keyed on its source, not on any built artifact

`deriveBuildTag` is unchanged, and the commit stays in the image tag — a
distinct build must keep a distinct tag or the local image cache stops working
and a rebuild silently serves the previous commit's binary. What changes is
what counts as a **row**.

An entry's key is the **source**, in one of two forms:

- **built** — `(repo, dockerfile)`. Its versions are commits, and the image tag
  of each version is what `deriveBuildTag` already produces, so entries
  reconcile against the daemon listing with no second source of truth. An
  absent `dockerfile` is part of the key as the empty value, exactly as
  `deriveBuildTag` folds `dockerfile ?? ''` today.
- **referenced** — an image reference with no tag, e.g. `mediforce-golden-image`
  or `registry.example.com/my-agent`. Its versions are tags or digests. This is
  the form for `mediforce-golden-image` itself and for anything hand-built and
  pushed, where the platform holds no build inputs at all.

Both are one table, keyed per namespace by an id derived deterministically from
the source — the same shape `tool_catalog_entries` uses, where the composite
primary key is `(workspace, id)` and the id is derived from the entry's own
content. Two kinds, one object: they differ in where their versions come from,
not in what they are.

**Why the commit is not in the key.** The thing an author picks is not a build.
It is a line of images they choose to depend on — *"the TealFlow agent image"* —
and the step already pins the exact build, through `commit` in build mode or
through the tag otherwise. Folding the commit into the catalog key makes the
platform mint a new top-level row for a change the author regards as an
update to a thing they already chose, which is the structural cause of the
"tons of near-identical images" complaint. Dropping it turns those rows into
versions of one entry, and turns "which of these seven do I pick" into "this
one, and here is its history".

**Why not key on the image id or digest.** Content-addressed identity changes on
every rebuild, including a no-op rebuild that picked up a new base layer. That
is the same monotonic growth wearing a different name.

Two boundaries this key draws, both intended: two Dockerfiles in one repo
(`container/Dockerfile`, `container/Dockerfile.gpu`) are two entries, because
they are two images; and the same source built in two namespaces is two
entries, for the reason in decision 3.

### 2. Every fact is derived; the only declared field is intent

Runtimes and agent-capability are probed from the image (#1295). Lineage and
base are computed from `RootFS.Layers` prefix containment (#1296). Versions,
commits, sizes and build provenance come from the daemon and the build labels
(#1285). The human writes exactly one required field: **intent**, one sentence
saying what the image is *for* — *"TealFlow agent — R-based interactive
exploration of ADaM datasets"*.

**Why.** A hand-written capability list drifts silently and takes the reader's
trust with it. Someone bumps a Dockerfile from Python 3.9 to 3.11; the entry
still says 3.9; nobody finds out until a run fails, and by then the whole
catalog is suspect. This is the exact failure mode AGENTS.md §11 exists to
prevent, and the one that filled the retired wiki with pages describing deleted
code ([ADR-0017](./0017-retire-llm-maintained-wiki.md)). A catalog of
hand-maintained contents fields is that wiki with a database schema.

**This is why there is no free-form "contents" field**, and the distinction is
sharper than "short vs long". Intent survives a rebuild — *"R-based interactive
exploration of ADaM datasets"* stays true across every version of the image.
Contents do not: *"R 4.4, Python 3.11, teal 0.15"* is false the first time
somebody bumps a pin, and it is false in a way no test catches. So the facts
that go stale are the ones the platform recomputes, and the one thing a human
writes is the one that does not.

**A derived fact has three states — present, absent, and unknown.** Unknown is a
state, not an error. An unreachable daemon, an absent image or a probe timeout
degrades an entry to `capabilities: unknown`, and a consumer treats unknown as
"offer it, do not vouch for it" (AGENTS.md §13). A catalog whose facts cannot be
computed today still renders — never an error page, never an empty picker.

**One declared exception, recorded rather than hidden.** An entry may carry an
optional source reference — `sourceRepo` / `sourceCommit` / `sourceDockerfile`
(#1294) — for an image the platform did not build. It exists because for a
pushed image there is no derivable alternative: OCI labels are inherited from
the base image, so a local image of ours reports
`org.opencontainers.image.source = https://github.com/rocker-org/rocker-versioned2`
from `rocker/tidyverse`, and reading that as provenance sends a user to the
wrong repository with total confidence. The field is optional, marked as
**declared rather than derived** wherever it is shown, and ranked below every
derived source. It is the one place where declaring beats having nothing, not a
licence to declare what could be derived.

### 3. Entries are namespace-scoped rows in Postgres, written by any member

**Storage.** Postgres via `platform-infra`
([ADR-0017](./0017-retire-llm-maintained-wiki.md),
[ADR-0001](./0001-firestore-to-postgres.md)), one table, per-namespace composite
key, a repository port in `platform-core` and handlers in `platform-api` —
mirroring `tool_catalog_entries` in every structural respect.

**No cross-namespace visibility field.** `visibility: public` exists on a
Workflow because a Workflow is a thing another workspace might legitimately want
to read and copy. An entry is a sentence about an artifact that is *already*
shared: the Docker daemon is deployment-wide — image deletion audits under
`_system`, not under a namespace — and any step in any namespace can already
name any image string. Adding a visibility flag would introduce a second sharing
mechanism for something nothing isolates, and immediately raise the question of
who may edit a row two workspaces read. Two namespaces that build the same image
keep two entries and two sentences. Duplicated prose is the cost paid; a
cross-namespace write path is the cost avoided.

**The catalog is therefore not an isolation boundary,** and this must not be
misread later: an image absent from your namespace's catalog is not an image
your namespace is denied. It is one nobody here has described yet.

**Any workspace member may create, edit and delete an entry.** Every write is
audited the way a Tool Catalog write is. This is deliberately looser than the
Tool Catalog, which is admin-gated, and the difference is what the two objects
*are*. A Tool Catalog entry is a command line that **executes** inside an agent
container; `catalogId` exists precisely so a workflow cannot inline one, and
admin gating is what makes that meaningful. An Image Catalog entry executes
nothing. It names an image string any author can already type into the step
editor's free-text field, and every fact on it that could mislead is derived
rather than typed. The blast radius of a bad entry is a bad recommendation.
Gating that behind an admin would leave the catalog stalest in exactly the
deployments where authors build the most images — which is how the picker
became useless in the first place.

**Deleting an entry is safe by construction, and the property that makes it safe
is load-bearing: no Workflow Definition ever references an entry.** A step
stores an image string, as it does today. Removing an entry removes an offer,
never a capability: no run changes behaviour, no definition becomes invalid, no
pinned version stops resolving (AGENTS.md §12). If a future change makes a
definition point at an entry id, this paragraph stops being true and the write
gate has to be revisited with it.

**The golden image gets a seeded entry in every namespace.** Without it a new
workspace opens the catalog on nothing, and #1296's grouping has no root to
group under — a feature that needs a per-deployment setup step to be useful is
not deployable (AGENTS.md §13). This is the move
[ADR-0020](./0020-built-in-roles-and-default-workflow-access.md) made for
built-in roles: the platform writes the thing into the ordinary place rather
than teaching every reader a special case. Afterwards it is an ordinary entry —
editable, deletable, and carrying no standing the gate or the picker knows about.

*Rejected: a deployment-level `_system` shelf merged into every namespace's
read.* It needs a merge rule, a shadow rule for when a namespace defines the
same source, and a second admin surface to administer it — three new concepts to
avoid one seeded row.

### 4. The Image Catalog and the Tool Catalog are siblings, not nested

Golden rules §7 already states the principle one level up. The Image Catalog is
the same move one level down, in the same vocabulary: building an image makes it
runnable; it does not make it selectable.

**An image that ships an MCP executable still needs its own Tool Catalog entry.**
That entry's `command` runs inside whatever image the step selected, and neither
object knows about the other. This catalog does not govern MCPs and gains no
`mcpServers` field — the temptation is real and the reason it is refused is
concrete: an executable installed in one image is present in every image derived
from it, so an MCP list on an image entry would be a second, inherited,
permanently drifting copy of the Tool Catalog. Governance of MCPs stays exactly
where §7 put it.

The two objects also differ in kind, which is what justifies their different
write gates and their different derived/declared balance. A Tool Catalog entry
**is** the definition — the command is the thing, and there is nothing to derive
it from. An Image Catalog entry only **describes** an artifact built elsewhere,
which is why almost all of it can be computed and almost none of it should be
typed.

### 5. The catalog curates the picker; it is not an allowlist

A step may still name any image string. Nothing at registration, readiness or
run time checks that the string appears in the catalog.

Three reasons, any one of them sufficient:

- **Every existing definition names a string authored before the catalog
  existed.** Enforcing membership would break workflows that run today
  (AGENTS.md §12).
- **Workflow packages travel between deployments**
  ([ADR-0013](./0013-workflow-packages-outside-platform-repo.md)). An imported
  package's image string was authored against another deployment's estate;
  [`import-from-git.md`](../guides/import-from-git.md) already warns that base
  images must exist there. Turning that warning into a rejection would move a
  run-time reality into a registration-time gate, so an import that works today
  would start failing at the door.
- **The daemon is deployment-wide and entries are namespace-scoped** (decision
  3), so an allowlist would refuse images the runtime can start perfectly well.

What replaces enforcement is a better offer: the picker lists only entries that
suit the step, and the existing preflight `missing-image` warning keeps telling
an author when the image they named is not there. **Filtering an offer is not
the same as refusing a value**, and only the first is safe to add to a control
authors already depend on. Concretely, #1298 kept the free-text field beside the
select and the branch that appends an unrecognised pinned value as its own
option, so every string that saved before still saves and round-trips.

### 7. A source the platform built appears in the catalog undescribed

*Added 2026-09-08.*

The catalog offers every source **this namespace built** and nobody has
described — one **discovered entry** per `(repo, dockerfile)`, derived on read
from the `mediforce.build.*` labels the builders already write. Everything on it
is as derived as a stored entry's: the source key, the versions, the commits,
the workflow that triggered the build, the lineage. The one field missing is
`intent`, which is empty, and the view says so and offers the form that fills
it. Describing one is an ordinary `POST`; because the id is derived from the
source (decision 1), the row lands at the id the discovered entry already had.

**The problem this fixes.** Decisions 1-6 shipped a catalog with exactly two
write paths — `mediforce images create` and the API — and a build path that
writes neither. So a workspace that ran a build-mode workflow got an image on
the daemon labelled with its repo, commit, Dockerfile and workflow, and a
catalog that had never heard of it. That image was not one click away in the
picker (decision 5), was not in the Images view, and had no affordance anywhere
saying it could be. Nothing was broken; nothing surfaced it either, and the
enrolment step lived in an operator's terminal.

**Why derived on read rather than written at build time.** They retrieve the
same facts — the builder writes them onto the image, and the daemon listing
reads them all back — so the write buys nothing and costs a Postgres or API
dependency inside `container-worker` and `agent-runtime`, on the path where a
run is starting. Derivation also works backwards: every image built before this
decision appears too, which a write-at-build-time rule could never do.

**Why not persisted with a nullable intent.** A discovered entry holds nothing a
human wrote, so a row would only have to be garbage-collected when its image
goes. Storing it would also make `intent` optional in the schema, the contract,
the CLI and the picker — weakening decision 2's invariant everywhere in order to
represent an absence that not being a row already represents. Discovery costs
one filter over the daemon listing the entry views fetch anyway: no extra daemon
call, no probe, no write, on a listing polled every 30 seconds.

**Capabilities are probed on the single-entry read, into a memo rather than a
row.** A discovered entry has nowhere to store one, and a probe is a container
start — so probing it on every 30-second poll of an open card is the behaviour
`refreshEntryCapabilities`' `unattemptedOnly` exists to prevent. The memo is
keyed on the daemon's immutable image id, which is why it needs no TTL and no
invalidation: an answer for that id cannot go stale, since a rebuild mints a
different id. So a discovered entry fills in its capabilities exactly where a
stored one does — the user-initiated, one-at-a-time read — and the listing
starts no probe for either kind, while showing what an earlier read already
paid for. Losing the memo on restart costs one probe per image.

Making this the one derived fact a discovered entry never filled in was the
first shape of decision 7, and it was wrong: an entry where everything is
derived except the sentence has to derive everything except the sentence, and
`Capabilities not probed` on a card with no way to change it reads as a defect
rather than a design.

**Three images are not offered, and the rule does the excluding.** An image
built for another namespace (the build recorded which one), an image the
platform did not build (`postgres`, `redis`, a dangling layer — no build labels
at all), and a build from a local filesystem path, which nothing can rebuild and
which is test residue. Only the last needs a written rule; the first two fall
out of "built here".

**This does not make the catalog a view over the daemon.** It offers sources
this deployment's own builder produced *for this namespace*, which is a strictly
smaller set than `docker images` and carries the platform's own provenance.
Admin → Infrastructure remains the raw inventory (decision 3), and a pulled or
hand-built image is still catalogued by hand — there is nothing to derive its
source from.

### 6. The vocabulary, fixed before the code

This ADR is the canonical home for the vocabulary while none of the objects
exist. [`CONTEXT.md`](../../CONTEXT.md) is the glossary for what the platform
*has*, so these names move there in the PR that first ships one — not ahead of
it, so the glossary never defines a thing a reader cannot go and find:

- **Image Catalog** — the per-namespace set of entries; the curated shelf of
  images offered for steps. Sibling of the Tool Catalog.
- **Image Catalog Entry** — one image the platform offers, identified by its
  source (decision 1), carrying derived facts and one declared intent.
- **Version** — one built artifact of an entry's source: a commit for a built
  entry, a tag or digest for a referenced one, with the image tag that names it
  on the daemon.
- **Intent** — the single required human sentence: what this image is *for*.
  Not a description of its contents.
- **Capability** — a derived, probed fact about a version: the runtimes it
  carries and whether it is **agent-capable** (an agent CLI *and* `bash`).
  Present, absent, or unknown; never declared.
- **Lineage** — the ancestry relation between images, computed from
  `RootFS.Layers` prefix containment, not parsed from `FROM`.
- **Base** — an entry's nearest ancestor in the catalog, or `none` for a root.
- **Discovered entry** — an entry derived from an image this namespace built
  that nobody has described (decision 7). Not a stored row, and the only entry
  whose **Intent** is empty; every derived fact on it, capabilities included, is
  filled in the way a stored entry's is. Its opposite is a **catalogued** entry;
  `origin` is the field that says which.

**Golden image**, pinned to one meaning: the deployment's own agent-capable base
image — built from
[`Dockerfile.base`](../../packages/agent-runtime/container/Dockerfile.base), named
by `DEFAULT_AGENT_IMAGE`, and the image an agent step falls back to at
registration when it names none. It is **not** a quality tier and confers no
standing: a curated entry is not "golden", and the golden image is not
"approved". The word used to be a magic string plus a hardcoded compare in the
picker; since #1298 its standing there is a probed fact (agent-capable) and a
computed one (the root most lineage hangs off). It survives in the picker in
exactly one place — the blank option, which names the image registration fills
in when a step pins none, because that is a fact about the runtime rather than a
claim about suitability.

## Consequences

Binding:

- **Two builds of the same source at different commits produce one entry with
  two versions.** A new *row* appears only when someone describes a source
  nobody has described before — but the catalog *shows* every source this
  namespace built, described or not (decision 7).
- **Every field except intent and the optional declared source reference is
  recomputable.** A catalog dropped and rebuilt from the daemon loses only the
  sentences, which is the property that keeps it from becoming a second source
  of truth.
- **Deleting an entry cannot affect a run.** Nothing in a Workflow Definition
  points at one.
- **The absence of an entry is never a denial.** Not for a step naming the image,
  and not for a namespace that has not described it.
- **A fact that cannot be computed is `unknown`, never an error.**
- **A discovered entry keeps its id when it is described.** The id is derived
  from the source, so describing one replaces it in place rather than adding a
  second row beside it.

User-visible changes, each a §12 gate in the issue that made it:

- **The step-editor picker stopped listing every daemon row** (#1298). The only
  change in the epic that could break authoring, which is why it shipped last,
  kept the free-text escape hatch, and kept the branch that preserves an
  unrecognised pinned value. Two consequences a reader should expect: an image
  on the daemon that no entry describes is no longer one click away — it is
  typed, not picked — and a catalog that covers images but suits *this* step
  with none of them offers none, rather than falling back to the daemon list it
  was built to replace.
- **Admin → Infrastructure keeps showing raw daemon truth**, `postgres` and
  dangling layers included — an admin hunting 40 GB needs exactly that, and
  curating it would destroy its purpose. Its only change, shipped in #1297, is a
  cross-link on a row some catalog entry describes.
- **The `★` on `mediforce-golden-image` is gone** (#1298), replaced by the
  probed `agent-capable` property and lineage grouping.
- **An image a workflow here built is offered by the picker before anyone
  describes it** (decision 7), labelled `not described yet · not probed`. It is
  additive: nothing that was offered stopped being offered.
- **A deployment with no catalog authors exactly as it did before.** An empty
  catalog, or a daemon nobody can reach, degrades the picker to the daemon
  listing it always showed — unranked, since without a probe nothing has been
  measured (AGENTS.md §13).

## Out of scope

- **Changing `deriveBuildTag` or the image-tag shape.** The commit stays in the
  tag; only the catalog key drops it.
- **A registry or push workflow, image signing, provenance attestation.**
- **Layer-level diffing between two arbitrary images.** The delta of an entry
  against its own base is in scope (#1296); a general diff tool is not.
- **Garbage collection of superseded versions.** Marking a version superseded
  and unused is in scope; picking one version off an entry and deleting it is
  not. Deleting an entry's images *together with the entry* is in scope and
  keeps Infrastructure's admin gate — the catalog offers the composite act,
  never a second, looser way to destroy an image.
- **Any write path to git.** The catalog reads Dockerfiles; it never proposes
  changes to them.
- **Run-time enforcement of catalog membership** (decision 5).
- **Cross-namespace or cross-deployment sharing of entries** (decision 3).
- **Treating the catalog as authority on what exists.** A version whose image is
  gone from the daemon renders as unavailable — never hidden, never resurrected,
  never a 404.
