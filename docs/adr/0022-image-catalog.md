---
status: accepted
audience: engineers
last_reviewed: 2026-09-18
---

# ADR-0022: The Image Catalog is an image the platform offers, keyed on its source

**Date:** 2026-09-02
**Deciders:** Krystian Zieliński
**Epic:** [#1292](https://github.com/Appsilon/mediforce/issues/1292) — Step Image Catalog

**All eight decisions are built.** #1294 landed `image_catalog_entries`, the
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
its own catalog; decision 8 (#1376) after the rollout to staging found that a
workspace which has built nothing gets the pre-catalog picker back.

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

**An uploaded build context lands in a `referenced` entry** (#1345). The
on-demand build does nothing for a Dockerfile in no repo the deployment can
clone, so `mediforce images build --reference --context` and **Add image → Local
folder** upload the folder as a tar and build it through the worker's same
`POST /images/build`. Neither of the two structural options the schema offered
was loosened: discovery keys on a build repo and an upload has none, and the
`built` arm requires one — so the upload catalogues itself, and as `referenced`,
which is the honest kind: the context is deleted once built, so the platform
holds no inputs, cannot rebuild or verify the image, and its versions are tags.
`declaredSource` is where the uploader states provenance, which is the case
decision 2 carved it out for. The build blanks every inherited
`mediforce.build.*` label except the namespace, so an upload `FROM` a platform
build is never offered as a version of it. Two rules are new, both because the
daemon is deployment-wide while the catalog is not an isolation boundary
(decision 3): the reference **must start with the workspace handle**
(`acme/agent`), or one workspace could tag over another's image or over
`postgres`; and **a tag already on the daemon is refused, never replaced**, since
a step pinning it would silently start running something else — the change the
delete flow refuses a live pin to prevent. A daemon that cannot say whether the
tag is free refuses the upload rather than assuming it is. Uploading is a
member's right, as a repo build is: the same member can already run any
Dockerfile on the host through a build-mode step pointed at a repo of their own.

The tag is checked twice, because a build takes minutes: by the handler before
building, so a taken tag costs nothing, and by the worker once built. The build
runs under a throwaway `mediforce-upload-staging:<uuid>` tag that is moved onto
the requested one only if that tag is still free, so two uploads racing for one
tag during a minutes-long build cannot overwrite each other. The check and
`docker tag` run synchronously back to back, so within one build host nothing
lands between them; what is left is a second process tagging on the same daemon
in those milliseconds. The worker also counts the archive as it unpacks it and
stops past the limit, for a caller that skipped the platform's check. **The first upload of a reference creates its entry**, and it is
audited as `image_catalog_entry.created`, like **Add image**. Its `name`,
`intent` and `declaredSource` belong to the entry, not to a version, so a later
upload may repeat them but never change them. Otherwise one version's declared
commit would silently become every version's. Editing the entry is how they
change.

**The upload is a tar, packed by the platform and extracted by the worker.** A
tar is what a build context already is, and it carries what a plain file upload
cannot: the executable bit a copied entrypoint needs, and symlinks.
`platform-core` writes and lists the archive itself (ustar with PAX long names,
browser-safe), so the Images view, the CLI and the handler share one codec. It is
written here rather than taken from a library because the check is the point:
it needs every entry's link target and its PAX/GNU long name applied to refuse a
hard link out of the context or a path under a symlink, and the CLI must write
symlinks. `nanotar`, the browser-safe library, reports neither a link target nor
an applied long name and cannot write a symlink; the complete ones (`tar-stream`,
`tar`) need Node streams. The
CLI packs with it rather than with the system `tar`, whose macOS build adds `._*`
files that a `COPY .` would carry into the image. The same
`checkBuildContextArchive` runs before the upload and again in the handler. It
refuses a context over 100 MiB (under Next's 110 MiB body cap, which truncates
a larger body before any handler can say why). It also refuses an entry path
that is absolute or climbs out, an entry under a symlink, a hard link outside
the context, and anything that is not a file, directory or symlink. The worker
extracts the archive into a temp dir with the host's `tar` and builds that
directory the way it builds a checkout. It does not pipe the archive to `docker
build -`, which applies no `.dockerignore` inside a piped archive.

**The clients apply the `.dockerignore` before packing, and the build host
applies it again.** Uploading what the file excludes only to have Docker drop it
made a folder holding test data unbuildable: `apps/landing-zone` is 337 MB of
sample data around a Dockerfile that copies 80 KB of scripts. `platform-core`
ports Docker's own matcher (moby/patternmatcher, with `ignorefile`'s line
cleaning and BuildKit's `<Dockerfile>.dockerignore` precedence) rather than a
`.gitignore` library, whose rules differ, and rather than `@balena/dockerignore`,
which needs `node:path` and predates Docker's parent-directory rule. Docker
applying the file again is what makes a client's port safe to be wrong: a pattern
read differently can only drop a file Docker would have kept, which fails loud
as a `COPY` that cannot find it, and never puts into the image something the
file excludes. The Dockerfile and the ignore file always travel, as Docker
always sends them. The Images view also lets a member uncheck anything else for
one upload. What the ignore file excludes cannot be checked back, since the
build would drop it anyway.

**A built source may name a build context, and the key leaves it out.** With
the context always the Dockerfile's own directory, a `container/Dockerfile` that
`COPY`s `scripts/` could not be built at all. `context` is a directory from the
repo root, and once it is set `dockerfile` is read from it — docker-compose's
contract. It extends decision 1 without moving any existing key: the Dockerfile
half of the key is `catalogDockerfileKey`, the Dockerfile's path from the repo
root, which for a source with no context is `dockerfile` exactly as written, so
no id minted before contexts existed changes. The context stays out of the key
because it is how the file is built, not which file it is: one Dockerfile built
from two contexts is one entry with versions of both, and the context stored on
the entry is the one its **Build** action uses. Because `dockerfile` is read
from the context, a change that makes the same path name a different file does
re-key the entry. `deriveBuildTag` does fold the context in — only when set,
and normalised, so no existing tag moves either — because two builds of one
Dockerfile at one commit from different contexts are different images and must
not share a cache slot. The `mediforce.build.context` label is written on every
build, empty when none was named, so an image cannot inherit its base's. A path
that climbs out of the repository is refused by the contract, and one the
checkout reaches through a symlink is refused by the builders after cloning.

**A Dockerfile a workflow carries is a third kind of source, `carried`.** A
step whose `dockerfile` names a file in the definition's `artifacts` builds from
those files with no repository anywhere, under
`mediforce-artifacts:<content hash>`. Those images were on the daemon and in no
catalog: discovery keys on a build repo and a carried build has none, and the
delete flow's pin scan recomputed only repo-derived tags. So an edited script
minted a new image no view showed, and one a live version ran on could be
deleted from under it. Neither `built` nor `referenced` fits: there is no repo
to key on, and a reference would claim a name nobody chose.

- **Key** — `(workflow, dockerfile)` in the row's namespace, the Dockerfile as a
  path from the root of the carried files. There is no context to key on: a
  carried build always reads every carried file. A workflow name is unique only inside
  its namespace, so versions also match on the namespace label, which a `built`
  source deliberately does not — two workspaces' `intake` workflows would
  otherwise offer, and let an admin delete, each other's images.
- **Versions** are content hashes (`mediforce.build.artifacts`), shown where a
  built version shows its commit. The build now labels the Dockerfile as the
  step named it, beside the workflow and namespace, and writes the context label
  empty. The hash changed shape, so the next run rebuilds and labels it. An
  image built before carries a blank Dockerfile label, so it is never discovered
  and stays on the daemon until someone removes it by hand.
- **Discovery** is decision 7 unchanged: an image this namespace built from a
  workflow's files is offered undescribed, and describing it lands at the id it
  already had.
- **The context is always the whole carried set**, as it was before carried
  images were catalogued, and `dockerfile` is a path from the carried root — a
  carried file is named by that path everywhere else. A `context` next to a
  carried Dockerfile is ignored, and the step editor offers none. Two
  alternatives were tried and reverted. Making it the Dockerfile's own
  directory, as a repo build does, broke a `container/Dockerfile` that `COPY`s
  `scripts/`. Honouring a `context` the step named broke every registered
  version that named one while it was ignored — the old editor showed the field
  on every step — and a registered version cannot be edited to drop it. Every
  carried file is hashed, as are the workflow and namespace, so identical files
  in two workflows build two images, each labelled truthfully.
- **The pin scan resolves a step's image with the runtime's own function**
  (`resolveStepImage` takes the definition), so a live version pinning a
  carried tag blocks a delete. It previously ignored carried files and, beside an
  `externalSkillsRepo`, named a `mediforce-built:*` tag the runtime never built.
- **Publish** copies one version into a `referenced` entry, for an image that
  should outlive its workflow. It finds the workflow version whose files hash to
  that image, packs every carried file as the context, and sends it through the upload path, so every
  upload rule holds: a reference in the workspace, a tag never replaced, no build
  label inherited. It rebuilds rather than re-tags. A re-tag would keep the
  carried labels, making the published tag a version of both entries, and
  deleting the carried entry with its images would take the published one too.
  The layers are cached, so the rebuild is short. If no version still carries
  the files, it is refused.

There is no **Build** for a carried entry: nothing names a commit to build, and
a run or dry run is what builds one.

**No build lands on a name the catalog owns.** A step may name the `image` it
builds under, which is how an author gives a carried build a readable tag. That
tag is refused when it starts with the workspace handle — the shape an upload
and a **Publish as image** create — and the build uses its derived tag instead.
Without this a run rebuilt the published image from the workflow's carried
files: the tag the upload path refuses to replace was replaced anyway, the
catalog offered one artifact under two entries, and deleting the carried entry
with its images would have taken the published one too. It is the rule that
already protects the golden image, applied to the names this ADR mints. A step
naming both an `image` and a carried `dockerfile` is also ambiguous — the
carried files win, so the pinned image never runs — and preflight says so before
the run rather than leaving it to be discovered afterwards. Two entries can
still describe one artifact for as long as it takes to clean up an image built
under the old rule, so the picker offers a tag once however many entries claim
it: the value that lands in the definition is the same string, and a second
option would offer no choice.

**A registry pull lands in a `referenced` entry, under the same rules as an
upload.** A public image had no browser path onto the daemon: a step naming it
pulled it on first run, but until then **Existing image** had nothing to offer
and the catalog could only describe it through `mediforce images create
--reference`, leaving an entry with no versions. `mediforce images pull` and
**Add image → Registry image** run `docker pull` through the worker's
`POST /images/pull` (or in-process when the daemon is local) and catalogue the
result. It is the upload path with the build replaced by a pull —
`addReferencedVersion` is the one implementation of both — so the entry rules are
one set: the first pull of a reference creates its entry and needs the intent,
a later tag only adds a version and may not rewrite the entry, and a tag already
on the daemon is refused rather than replaced. Unlike an upload, `docker pull`
writes the tag directly with no staging tag to move, so the worker checks the
tag again immediately before pulling and a race in that gap is accepted. The
reference is stored the way the daemon lists it — Docker Hub's host and
`library/` dropped — since a `referenced` entry resolves its versions by that
listing. The reference is not required to start with the workspace handle,
because a registry image is somebody else's name; instead a reference whose
first segment is **another** workspace's handle is refused, or a Docker Hub
image named `acme/agent` would land on the daemon as a version of workspace
`acme`'s uploaded entry. A first segment with a dot or a port, or `localhost`,
is a registry host and never a handle. The check is the platform's: the
worker's route takes any well-formed `reference:tag` and is protected by the
worker secret, like every route that acts on the daemon. A digest is not
accepted yet — a version of a `referenced` entry is a tag. Pulling is a member's right, as uploading is: a step
naming the image already pulls it at run time. A private registry still needs a login the
**worker** can read: the pull runs inside `container-worker`, whose Docker CLI
reads its own `/root/.docker` rather than the host user's, so
`docker-compose.prod.yml` mounts `DOCKER_CONFIG_DIR` (default
`/home/deploy/.docker`) there read-only. Unset, it mounts empty and public
pulls work as before (§13). The platform holds no registry credentials of its
own and never asks for any.

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

**Deleting an entry takes its images with it, and needs admin of the
workspace.** This narrows decision 3's write gate, and the reason the original
formulation does not survive is decision 7. "Removing an entry removes an offer"
is true of the *row*, but for a source this namespace built the row is
re-derived on the next read: deleting the record alone loses the sentence
somebody wrote, leaves the image on the daemon, keeps it in the step-editor
picker, and brings the entry back marked *needs a description*. A delete that
achieves that is not a lesser act deserving a lighter gate; it is a worse one.
So the entry and its images are one act — and when the daemon holds no image
for the entry, that act is just the record. Creating stays a member's right, so
a member can add an entry they cannot remove; that asymmetry is accepted, on
the ground that adding an offer is reversible by an admin while destroying a
deployment-wide artifact is not reversible by anyone.

The gate is `assertCallerIsNamespaceAdmin`, not
`assertCallerCanAdminDockerImages`, whose own comment calls it a loose
approximation until #376 — owner or admin of *any* namespace, which nearly
every user satisfies through a personal workspace. That looser gate is still
all that stands at the other door: **Admin → Infrastructure** and
`mediforce system rmi` reach the same deployment-wide daemon without a workspace
to be admin of. #1375 therefore moved the live-pin refusal below both doors,
into `deleteDockerImage` itself — the gates still differ, the check no longer
does. It resolves an image id to every tag that names it first, since
`docker rmi` on an id takes them all, and refuses outright when the daemon
cannot list them: an unreachable daemon degrades to an empty listing by decision
2, which is the right answer for a read and a silent fail-open here.

Neither door gets a `force`. Re-pointing the step or archiving the version is
the answer, as it already was for the catalog — a flag that destroys an image
400 live steps run on is the behaviour this revision removed, not one to
re-offer behind a checkbox. Rebuilding the shared golden image is not affected:
it is replaced in place on the host (`scripts/rebuild-docker-images.sh`), never
by deleting it first.

**A live workflow version blocks the delete; a superseded one does not.** Live
means the version a run starts from, by the same `pickRunnableVersion` rule
every firing uses: the default version when it is itself live, otherwise the
newest non-archived one. Archiving the head therefore hands the pin to the
version runs fall back to, which blocks in turn. The asymmetry is forced by
immutability: a registered version cannot be edited, so a historical pin can
never be moved off the image, and refusing on its account would mean an image
pinned once could never be reclaimed. A live pin *can* be re-pointed, so it is
refused with a 409 that names the workflow, version and steps, and the UI offers
to archive that one version rather than the whole workflow — naming it
**Archive workflow** when it is the only runnable version left, since archiving
it then archives the workflow, which stays restorable from the workspace
catalog's *Display → Archived workflows*. A version pinned as
the workflow's default is excluded from that remedy: archiving it would leave
the workflow pointing at something that cannot run — a rule only the definitions
UI enforced, and which this flow must therefore honour itself.

The judgement is deployment-wide because the daemon is, so a step in a namespace
the caller cannot read blocks the delete just the same. The *disclosure* is not:
the 409 names only what that caller may already see and counts the rest. The
deliberately unfiltered read behind it is `listGroupsForImageAudit`, which says
so in its own comment; every other read stays namespace-filtered.
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

An entry's key is the **source**, in one of two forms (a third, `carried`, was
added later — see the amendment on carried sources, above **Context**):

- **built** — `(repo, dockerfile)`. Its versions are commits, and the image tag
  of each version is what `deriveBuildTag` already produces, so entries
  reconcile against the daemon listing with no second source of truth. An
  absent `dockerfile` is part of the key as the empty value, exactly as
  `deriveBuildTag` folds `dockerfile ?? ''` today. A source may also name a
  build context, which is not part of the key — see the amendment on build
  contexts, above **Context**.
- **referenced** — an image reference with no tag, e.g. `mediforce-golden-image`
  or `registry.example.com/my-agent`. Its versions are tags or digests. This is
  the form for `mediforce-golden-image` itself and for anything hand-built and
  pushed, where the platform holds no build inputs at all — including an image
  built from an uploaded context (see the amendment above).

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
described — one **discovered entry** per `(repo, dockerfile)`, or per
`(workflow, dockerfile)` for a Dockerfile a workflow carries, derived on read
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

### 8. A new workspace is born with the images a step falls back to

*Added 2026-09-18 (#1376).*

Every workspace is created with five catalogued entries: the image an agent step
falls back to when it names neither an image nor a build source
(`DEFAULT_AGENT_IMAGE`), and the four a `script.runtime` step falls back to
(`DEFAULT_SCRIPT_RUNTIME_IMAGES` — `mediforce-node`, `python`, `rocker/r-ver`,
`alpine`). Both creation paths seed them: `createNamespace`, and the personal
workspace `getMe` bootstraps on first sign-in, which is where most workspaces
come from.

**The problem this fixes.** Decision 7 fills a catalog from what a namespace
*built*; a workspace that has built nothing gets nothing, so a new workspace
opened on *"No images catalogued yet"* and a picker falling through to
`buildDaemonImageGroups` — the raw deployment-wide daemon listing, `postgres`
and `caddy` included, with no intent sentences and no filtering. That is the
pre-catalog behaviour decision 5 set out to replace. Worse, the fallback in
decision 5 turns on whether the catalog covers *any* image, so the first entry a
member catalogued by hand flipped that workspace to catalogue-only and dropped
their agent picker from every daemon row to one. A workspace that catalogued one
image was worse off than one that catalogued none, and nobody could be expected
to know that.

**The set is derived from the engine's constants, never a second list.** The
seed is exactly what the engine defaults to, so it reads `DEFAULT_AGENT_IMAGE`
and `DEFAULT_SCRIPT_RUNTIME_IMAGES` — the same constants
`ScriptContainerPlugin` runs from. A hand-written copy would offer last
release's `python` the first time one of them changed. Each goes through
`daemonRepositoryName(untaggedReference(...))` because a `referenced` entry is
keyed on the repository with no tag (decision 1): one row with a version per tag,
not a row per tag.

**A seeded row is named after its image.** `mediforce-node`, not "JavaScript
runtime": the name is what an author types into a step's image field, it matches
what a hand-catalogued row is called and the basename `discoverEntries` suggests
(decision 7), and the `intent` sentence beside it carries the meaning a prose
label would. Deriving the name from the reference also keeps the seed one fact
per image rather than a label that can drift from the constant it describes.

**A seeded `intent` is compatible with decision 2.** These sentences are
human-written — once, in code, beside the constants they describe — and they say
what the *platform* does with the image ("The image the engine runs a Python
script step in when the step names none"), which is a fact about the engine and
not a generated description of an image's contents. What decision 2 refuses is a
machine filling the field so the row can exist; that is still refused, and
`adopt_daemon_images.py` still leaves `intent` blank for a human.

**Seeded without probing and never at the cost of the workspace.** The rows are
written through the repository with empty capabilities rather than through
`createImageCatalogEntry`, which reads the daemon and runs
`refreshEntryCapabilities` — five probe containers, which a first login blocking
on `getMe` cannot pay for. `getImageCatalogEntry` probes unattempted versions on
the first single-entry read, so they fill in on demand exactly as decision 7's
discovered entries do. The seed touches no daemon at all, so an unreachable one
costs the versions and not the rows; and the whole seed is best-effort, reported
in the creating handler's own audit entry (`seededImageCatalogEntries`) the way
the ADR-0020 grant beside it is. The workspace exists by the time this runs, so
failing the request would leave a real workspace behind a 500 and a retry that
can only 409.

**The rows are the workspace's, and editing or deleting one is ordinary**
(decision 3) — no shared or global catalog tier that every workspace reads, and
no second sharing mechanism to reason about. The one exception is the image
half of a delete: `isDefaultEngineImageSource` refuses `withImages` for these
references, and the UI offers only the record-only delete. The daemon is
deployment-wide and a step that names *no* image pins nothing, so the live-pin
check that protects every other entry is blind here — an admin of a
minutes-old workspace could otherwise take `python:3.12-slim` off the daemon for
every workspace on it. Derived from the reference rather than a stored marker,
so it holds for a row somebody renamed and for one catalogued by hand before
seeding existed.

**Backfilled by a script, not lazily on read.** `mediforce images seed` runs the
same helper, and `scripts/migrations/seed_default_image_catalogs.py` runs it over
a list of handles. Seeding on read would turn a listing polled every 30 seconds
into a write path, which is the reason decision 7 derives discovered entries
instead of storing them.

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
  entry, a tag or digest for a referenced one, a content hash for a carried one,
  with the image tag that names it on the daemon.
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
  measured (AGENTS.md §13). Since decision 8 a workspace reaches that state only
  by emptying its own catalog, or on a daemon holding none of the engine's own
  defaults.
- **A new workspace opens on five entries it did not write** (decision 8),
  described and sourced as `referenced`. Additive: nothing that was offered
  stopped being offered, and the rows are the workspace's to edit or delete.
- **The image behind an engine default cannot be deleted from a workspace**
  (decision 8). The record can; `--keep-images` is the only accepted form, and
  the UI offers only that. The one place the delete gate is stricter than
  "admin of this workspace plus no live pin".

## Out of scope

- **Changing `deriveBuildTag` or the image-tag shape.** The commit stays in the
  tag; only the catalog key drops it.
- **A registry or push workflow, image signing, provenance attestation.**
- **Layer-level diffing between two arbitrary images.** The delta of an entry
  against its own base is in scope (#1296); a general diff tool is not.
- **Garbage collection of superseded versions.** Marking a version superseded
  and unused is in scope; picking one version off an entry and deleting it is
  not — a delete is all of an entry's versions or none. Deleting an entry's
  images *together with the entry* is in scope and needs admin of the
  workspace, so the catalog never becomes a second, looser way to destroy an
  image.
- **Any write path to git.** The catalog reads Dockerfiles; it never proposes
  changes to them.
- **Run-time enforcement of catalog membership** (decision 5).
- **Cross-namespace or cross-deployment sharing of entries** (decision 3).
- **Treating the catalog as authority on what exists.** A version whose image is
  gone from the daemon renders as unavailable — never hidden, never resurrected,
  never a 404.
