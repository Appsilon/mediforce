/**
 * Abstract base class for plugins that run Docker containers.
 *
 * Shared logic: image build metadata resolution, env var resolution, context storage,
 * workspace lifecycle. Subclasses: BaseContainerAgentPlugin (LLM agents),
 * ScriptContainerPlugin (deterministic scripts).
 *
 * ## Container mounts — the `/workspace` vs `/output` split
 *
 * Every step container gets two bind mounts with distinct lifecycles and purposes.
 * Keeping them separate is deliberate — merging them would blur several concerns
 * that deserve to stay apart.
 *
 *   /workspace (host path = run worktree)
 *     - Git worktree for the run, shared across all its steps.
 *     - rw, persistent for the life of the run, tracked in git.
 *     - Commit happens at step boundaries; ignored files are wiped between steps.
 *     - This is where the agent / script writes *deliverables* — code, data,
 *       reports — whatever the workflow produces for its user.
 *
 *   /output (host path = per-step tempdir)
 *     - Ephemeral I/O channel between the engine and the step. Born on step
 *       start, deleted on step end. Never touched by git.
 *     - Host seeds inputs here before the container starts: `input.json`
 *       (stepInput), `previous_run.json` (carry-over), `prompt.txt` (agent
 *       plugins), `script.<ext>` (inline script mode), `mcp-config.json`.
 *     - The container writes the result contract: `result.json`.
 *     - Host reads `result.json` + optional `presentation.md` (preferred)
 *       or `presentation.html` + `git-result.json` (written by the host
 *       itself post-commit) after the container exits.
 *
 * ### Why separate
 *
 * - **Commit history stays about user work.** Inputs / prompts / previous-run
 *   payloads are engine plumbing. Committing them on every step would flood
 *   the run branch with housekeeping noise.
 * - **No naming conflicts.** A step that wants to write its own `input.json`
 *   or `result.json` as a deliverable can do so in `/workspace/...` without
 *   colliding with engine-owned files.
 * - **Control-plane vs data-plane.** `/output` is how the engine talks to the
 *   step; `/workspace` is what the step produces. Mixing them makes both
 *   harder to reason about.
 * - **Replay reproducibility is not weakened.** stepInput lives in Firestore
 *   (`processInstances/<id>/stepExecutions`). `/output/input.json` is a
 *   derivative — writing it to git would be duplication, not extra truth.
 *
 * ### Naming caveat
 *
 * The `/output` name is imperfect — it carries both inputs and outputs. If we
 * renamed it today we'd pick `/io` or `/step-io`. The current name is kept
 * because every existing `SKILL.md`, workflow definition, and prompt hardcodes
 * `/output/result.json`. A rename is a breaking change across all those and
 * belongs in its own PR.
 */
import { existsSync, mkdirSync, cpSync, renameSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StepExecutorPlugin, AgentContext, WorkflowAgentContext, EmitFn } from '../interfaces/step-executor-plugin';
import type { AgentConfig, ContainerConfig, PluginCapabilityMetadata, WorkflowArtifact, DockerBuildPaths } from '@mediforce/platform-core';
import {
  carriedBuildPaths,
  catalogDockerfileKey,
  normalizeBuildContext,
  normalizeRepoUrls,
  DEFAULT_AGENT_IMAGE,
  DOCKER_IMAGE_SETUP_URL,
} from '@mediforce/platform-core';
import { artifactsBuildHash, artifactsBuildTag, artifactsDir } from './workflow-artifacts';
import { cloneRepoAtCommit } from './git-clone';
import { writeFile } from 'node:fs/promises';
import type { GitMetadata } from '@mediforce/platform-core';
import { resolveStepEnv, type ResolvedEnv } from './resolve-env';
import type { ImageBuildMeta } from './docker-spawn-strategy';
import { WorkspaceManager, type RunWorkspaceHandle } from '../workspace/workspace-manager';
import { copyOutputFilesIntoWorkspace } from '../workspace/output-files';

export function isWorkflowAgentContext(ctx: AgentContext | WorkflowAgentContext): ctx is WorkflowAgentContext {
  return 'step' in ctx && 'workflowDefinition' in ctx;
}

/**
 * Resolve image build metadata for lazy Docker image building.
 *
 * A step opts in to lazy build when it has:
 *   a) step-level repo + commit (explicit — always enables lazy build), OR
 *   b) step-level dockerfile + workflow-level repo with commit (fallback)
 *
 * Steps without repo/commit/dockerfile are left alone (image must already exist).
 */
/**
 * Resolve the repo auth token from the step or workflow-level config.
 * `repoAuth` is the name of a key in resolvedEnv (sourced from workflow secrets).
 */
export function resolveRepoToken(
  buildConfig: ContainerConfig,
  context: AgentContext | WorkflowAgentContext,
  resolvedEnv?: Record<string, string>,
): string | undefined {
  // Step-level repoAuth takes priority, then workflow-level externalSkillsRepo.auth.
  const wfDef = isWorkflowAgentContext(context) ? context.workflowDefinition : undefined;
  const authKey = buildConfig.repoAuth
    ?? wfDef?.externalSkillsRepo?.auth;
  if (!authKey || !resolvedEnv) return undefined;
  return resolvedEnv[authKey];
}

/**
 * Derive a deterministic image tag from the build inputs so callers that
 * omit `image` in build mode still get a stable, cacheable tag.
 * Format: `mediforce-built:<12-char-sha256-hex>`.
 *
 * A context-less build hashes exactly `repo \0 commit \0 dockerfile`, as
 * written — the bytes every tag on a daemon or pinned by a registered step was
 * minted from. A build naming a context hashes the Dockerfile's path from the
 * repo root and the normalised context instead, so spellings of one build
 * (`.`, `./`, `/`) land in one cache slot.
 */
export function deriveBuildTag(
  repoUrl: string,
  commit: string,
  dockerfile?: string,
  context?: string,
): string {
  const inputs =
    context === undefined || context === ''
      ? `${repoUrl}\0${commit}\0${dockerfile ?? ''}`
      : `${repoUrl}\0${commit}\0${catalogDockerfileKey(dockerfile ?? '', context)}\0${normalizeBuildContext(context)}`;
  const hash = createHash('sha256').update(inputs).digest('hex').slice(0, 12);
  return `mediforce-built:${hash}`;
}

/** Git inputs a build-mode container config resolves to. */
export interface BuildSource {
  repoUrl: string;
  repoRef: string;
  commit: string;
  dockerfile?: string;
  context?: string;
}

/**
 * Resolve a container config's build inputs, applying the workflow-level
 * skills-repo fallback for a step that names only a `dockerfile`.
 *
 * Pure and context-free so the `by-image` scan can reach the same answer from
 * a stored WorkflowDefinition — a step that omits `image` runs under the tag
 * `deriveBuildTag` mints from exactly these inputs, and nothing else can name it.
 */
export function resolveBuildSource(
  buildConfig: ContainerConfig,
  workflowRepo?: { url?: string; commit?: string },
): BuildSource | undefined {
  const { dockerfile, context, repo, commit } = buildConfig;

  if (repo && commit) {
    return { repoUrl: normalizeRepoUrls(repo).gitUrl, repoRef: repo, commit, dockerfile, context };
  }

  if (dockerfile && workflowRepo?.url && workflowRepo?.commit) {
    const repoRef = repo ?? workflowRepo.url;
    return {
      repoUrl: normalizeRepoUrls(repoRef).gitUrl,
      repoRef,
      commit: commit ?? workflowRepo.commit,
      dockerfile,
      context,
    };
  }

  return undefined;
}

/**
 * A name the Image Catalog owns: `<this workspace>/<something>`.
 *
 * An entry published or uploaded from a workspace is named with its handle, and
 * the upload path refuses to replace a tag that already exists, precisely so a
 * step pinning it cannot start running something else (ADR-0022). A build that
 * wrote onto that name would walk around the rule: it would replace an image
 * the catalog offers, and hand one artifact to two entries at once.
 */
function isCatalogReference(image: string, namespace: string | undefined): boolean {
  return namespace !== undefined && namespace !== '' && image.startsWith(`${namespace}/`);
}

/**
 * The tag a step with a build source builds under, when it names one: never the
 * shared golden image, and never a name this workspace's catalog owns.
 *
 * Registration used to write the golden image onto a step whose Dockerfile came
 * from `externalSkillsRepo`, and a registered version cannot be edited, so the
 * build would replace the golden image on the host for every workflow using it.
 * Such a step builds under its derived tag instead, as does one whose `image` is
 * empty and one naming an image the catalog published.
 */
function buildTarget(image: string | undefined, namespace?: string): string | undefined {
  if (image === undefined || image === '') return undefined;
  const isGolden = image === DEFAULT_AGENT_IMAGE || image === `${DEFAULT_AGENT_IMAGE}:latest`;
  return isGolden || isCatalogReference(image, namespace) ? undefined : image;
}

/** The parts of a definition that decide where a step's image comes from. */
export interface StepImageDefinition {
  artifacts?: WorkflowArtifact[];
  externalSkillsRepo?: { url?: string; commit?: string };
  name?: string;
  namespace?: string;
}

/**
 * A build from a Dockerfile the workflow carries: the files are already on the
 * host for the /artifacts mount, so the build reads that directory and no clone
 * happens. The context is the Dockerfile's own directory unless the step names
 * one, as for a repo. `undefined` for a step that builds from anything else.
 */
export function resolveCarriedBuild(
  buildConfig: ContainerConfig,
  definition: StepImageDefinition | undefined,
): { tag: string; paths: DockerBuildPaths; meta: Omit<ImageBuildMeta, 'image'> } | undefined {
  const artifacts = definition?.artifacts;
  const paths = carriedBuildPaths(buildConfig, artifacts);
  if (artifacts === undefined || paths === null) return undefined;
  const build = { paths, workflow: definition?.name, namespace: definition?.namespace };
  return {
    tag: artifactsBuildTag(artifacts, build),
    paths,
    meta: {
      contextDir: artifactsDir(artifacts),
      artifactsHash: artifactsBuildHash(artifacts, build),
      dockerfile: buildConfig.dockerfile,
      context: buildConfig.context,
      workflow: definition?.name,
      namespace: definition?.namespace,
    },
  };
}

/**
 * The image tag a container config runs under: its explicit `image`, or the
 * tag derived from its build inputs when it leaves `image` unset.
 * `undefined` when the config names neither.
 *
 * Takes the definition rather than only its skills repo so the answer is the
 * one `resolveImageBuild` gives at run time — a carried Dockerfile wins over
 * `externalSkillsRepo` there, and a scan asking which images a version pins
 * must not name a `mediforce-built:*` tag the runtime never builds.
 */
export function resolveStepImage(
  buildConfig: ContainerConfig | undefined,
  definition?: StepImageDefinition,
): string | undefined {
  if (!buildConfig) return undefined;
  const carried = resolveCarriedBuild(buildConfig, definition);
  if (carried !== undefined) return buildTarget(buildConfig.image, definition?.namespace) ?? carried.tag;
  const source = resolveBuildSource(buildConfig, definition?.externalSkillsRepo);
  if (source === undefined) return buildConfig.image || undefined;
  return buildTarget(buildConfig.image, definition?.namespace)
    ?? deriveBuildTag(source.repoUrl, source.commit, source.dockerfile, source.context);
}

export function resolveImageBuild(
  image: string | undefined,
  buildConfig: ContainerConfig,
  context: AgentContext | WorkflowAgentContext,
  resolvedEnv?: Record<string, string>,
): ImageBuildMeta | undefined {
  const workflowDefinition = isWorkflowAgentContext(context) ? context.workflowDefinition : undefined;

  // Second to an explicit step-level repo+commit, which said something
  // specific, and ahead of the externalSkillsRepo fallback.
  const carried = resolveCarriedBuild(buildConfig, workflowDefinition);
  if (carried !== undefined) {
    return { ...carried.meta, image: buildTarget(image, workflowDefinition?.namespace) ?? carried.tag };
  }

  const source = resolveBuildSource(buildConfig, workflowDefinition?.externalSkillsRepo);
  if (!source) return undefined;

  return {
    ...source,
    image: buildTarget(image, workflowDefinition?.namespace) ?? deriveBuildTag(source.repoUrl, source.commit, source.dockerfile, source.context),
    repoToken: resolveRepoToken(buildConfig, context, resolvedEnv),
    workflow: workflowDefinition?.name,
    namespace: workflowDefinition?.namespace,
  };
}

const SKILLS_CACHE_DIR = join(tmpdir(), 'mediforce-skills-cache');

/**
 * Content-addressed cache directory for skills fetched from a git repo.
 * Key: sha256(repoUrl + commit + skillsDir). Pure — computable for free
 * whenever the path is needed, so nothing about it has to be stored on
 * shared instance state.
 */
export function skillsCacheDir(repoUrl: string, commit: string, skillsDir: string): string {
  const hash = createHash('sha256').update(`${repoUrl}\0${commit}\0${skillsDir}`).digest('hex').slice(0, 16);
  return join(SKILLS_CACHE_DIR, hash);
}

/**
 * Human-readable exit descriptor for a finished container or child process.
 * A SIGTERM kill is annotated as a likely timeout when the step's limit is
 * known — the signal name alone doesn't tell the user we killed it for
 * running too long.
 */
export function formatExitInfo(
  result: { exitCode: number | null; signal: string | null },
  timeoutMinutes?: number,
): string {
  if (result.signal === null) {
    return `exit code ${result.exitCode}`;
  }
  const timeoutHint =
    result.signal === 'SIGTERM' && typeof timeoutMinutes === 'number'
      ? ` (likely timeout — ${timeoutMinutes} min limit)`
      : '';
  return `killed by ${result.signal}${timeoutHint}`;
}

const MISSING_EXECUTABLE_RE = /exec: "([^"]+)": executable file not found/;

/**
 * Name the image and the executable behind runc's missing-entrypoint dump.
 * Returns '' for anything else, so callers append it unconditionally.
 */
export function missingExecutableHint(detail: string, image: string | undefined): string {
  const match = MISSING_EXECUTABLE_RE.exec(detail);
  if (match === null) return '';
  const executable = match[1];
  const imageLabel = typeof image === 'string' && image.length > 0
    ? `Image '${image}'`
    : 'The configured image';
  return (
    ` — Hint: ${imageLabel} has no '${executable}' executable. Steps run their` +
    ` command inside the image, so a minimal base image that ships neither a` +
    ` shell nor an agent CLI cannot run one. Pick or build an image carrying` +
    ` the tooling this step needs: ${DOCKER_IMAGE_SETUP_URL}`
  );
}

export interface CommitRunWorkspaceOptions {
  status?: 'success' | 'failed';
  /** Force the terminal marker (✓). Auto-detected from transitions when omitted. */
  isTerminal?: boolean;
  /** Optional agent reasoning summary — shown on the commit subject line. */
  reasoningSummary?: string;
  /** Error message for failed commits — placed in the commit body. */
  error?: string;
  /** Wall-clock step duration in milliseconds. Emitted as a trailer. */
  durationMs?: number;
  /** Plugin identifier override. Defaults to the subclass's `metadata.name`. */
  agentPlugin?: string;
  /** Docker image reference. Emitted as a trailer. */
  agentImage?: string;
}

export interface WorkspaceManagerLike {
  createRunWorkspace: WorkspaceManager['createRunWorkspace'];
  commitStep: WorkspaceManager['commitStep'];
}

export interface ContainerPluginInit {
  workspaceManager?: WorkspaceManagerLike;
}

export abstract class ContainerPlugin implements StepExecutorPlugin {
  abstract readonly metadata: PluginCapabilityMetadata;

  protected context!: AgentContext | WorkflowAgentContext;
  protected resolvedEnv: ResolvedEnv = { vars: {}, injectedKeys: [], sources: {} };
  protected imageBuild: ImageBuildMeta | undefined;
  /** Run-scoped git worktree — populated by `resolveRunWorkspace` at run start. */
  protected runWorkspaceHandle: RunWorkspaceHandle | null = null;
  protected workspaceManager: WorkspaceManagerLike | null = null;

  constructor(init: ContainerPluginInit = {}) {
    this.workspaceManager = init.workspaceManager ?? null;
  }

  abstract initialize(context: AgentContext | WorkflowAgentContext): Promise<void>;
  abstract run(emit: EmitFn): Promise<void>;

  protected createWorkspaceManager(): WorkspaceManagerLike {
    return new WorkspaceManager();
  }

  /**
   * Provision a per-run git worktree. Every step gets one — if the WD has no
   * `workspace` config, the runtime uses a default empty workspace (local-only
   * bare repo). Idempotent across the run's steps: subsequent calls re-attach
   * to the same worktree.
   */
  protected async resolveRunWorkspace(): Promise<void> {
    const workspaceConfig = isWorkflowAgentContext(this.context)
      ? (this.context.workflowDefinition.workspace ?? {})
      : {};

    const name = isWorkflowAgentContext(this.context)
      ? this.context.workflowDefinition.name
      : this.context.config.processName;
    const namespace = isWorkflowAgentContext(this.context)
      ? this.context.workflowDefinition.namespace
      : undefined;

    if (!this.workspaceManager) {
      this.workspaceManager = this.createWorkspaceManager();
    }

    const remoteToken = workspaceConfig.remoteAuth
      ? this.resolvedEnv.vars[workspaceConfig.remoteAuth]
      : undefined;

    this.runWorkspaceHandle = await this.workspaceManager.createRunWorkspace(
      { name, namespace, workspace: workspaceConfig },
      this.context.processInstanceId,
      { remoteToken },
    );
  }

  /**
   * Commit the step's workspace changes — ALWAYS, even on failure and even
   * when nothing changed. The run branch is meant to be a complete audit
   * trail of what the engine dispatched; `--allow-empty` keeps it isomorphic
   * to the step timeline.
   *
   * Marker selection:
   *   ◆ regular success
   *   ✓ last agent step of the run (no more agents will touch the workspace)
   *   ✗ failed — commits whatever the step produced before the error
   *
   * Before committing, copies the step's `/output` deliverables into
   * `.mediforce/output/<stepId>/` in the worktree (best-effort) so the same
   * commit captures them — see `copyOutputFilesIntoWorkspace`.
   *
   * Writes `git-result.json` into `outputDir` for downstream consumers.
   * Never pushes — run branches stay local for now.
   */
  protected async commitRunWorkspace(
    outputDir: string,
    opts: CommitRunWorkspaceOptions = {},
  ): Promise<GitMetadata | null> {
    if (!this.runWorkspaceHandle || !this.workspaceManager) return null;

    await copyOutputFilesIntoWorkspace(outputDir, this.runWorkspaceHandle.path, this.context.stepId);

    const commit = await this.workspaceManager.commitStep(this.runWorkspaceHandle, {
      stepId: this.context.stepId,
      stepName: this.resolveStepName(),
      status: opts.status ?? 'success',
      isTerminal: opts.isTerminal ?? this.detectLastAgentStep(),
      reasoningSummary: opts.reasoningSummary,
      error: opts.error,
      durationMs: opts.durationMs,
      agentPlugin: opts.agentPlugin ?? this.metadata.name,
      agentImage: opts.agentImage,
    });

    // Run branches are committed locally and never pushed (see comment above).
    // Even when a remote is configured, the commit/branch does not yet exist
    // on GitHub — emitting `remoteUrl` here produces broken `/commit/<sha>`,
    // `/compare/main...<branch>` and `/blob/<sha>/<file>` links in the UI.
    // Use the bare repo path so consumers can detect "not a real URL" and
    // render the metadata as plain text instead of GitHub deep links.
    const metadata: GitMetadata = {
      commitSha: commit.commitSha,
      branch: this.runWorkspaceHandle.branch,
      changedFiles: commit.changedFiles,
      repoUrl: this.runWorkspaceHandle.bareRepoPath,
    };

    await writeFile(join(outputDir, 'git-result.json'), JSON.stringify(metadata, null, 2), 'utf-8');
    return metadata;
  }

  /** Resolve the display name of the current step (falls back to stepId). */
  private resolveStepName(): string {
    if (isWorkflowAgentContext(this.context)) {
      return this.context.step.name ?? this.context.step.id;
    }
    return this.context.stepId;
  }

  /**
   * Last agent step = no outgoing transition leads to another non-terminal,
   * non-human step. We look at all outgoing transitions from the current step;
   * if every reachable next step is either `type: terminal` or `executor: human`,
   * this plugin invocation is the last one to touch the workspace, so its
   * commit gets the ✓ marker.
   *
   * Conditional transitions with mixed targets keep the regular ◆ marker —
   * we'd need to evaluate the condition to decide, and that's the engine's
   * job, not the plugin's.
   */
  private detectLastAgentStep(): boolean {
    if (!isWorkflowAgentContext(this.context)) return false;
    const { workflowDefinition, step } = this.context;
    const outgoing = workflowDefinition.transitions.filter((t) => t.from === step.id);
    if (outgoing.length === 0) return true;
    return outgoing.every((t) => {
      const next = workflowDefinition.steps.find((s) => s.id === t.to);
      if (!next) return true;
      return next.type === 'terminal' || next.executor === 'human';
    });
  }

  /**
   * Resolve environment variables from definition-level + step-level env + workflow secrets.
   */
  protected resolveEnvironment(
    definitionEnv?: Record<string, string>,
    stepEnv?: Record<string, string>,
    workflowSecrets?: Record<string, string>,
    namespaceSecretKeys?: ReadonlySet<string>,
  ): void {
    this.resolvedEnv = resolveStepEnv(definitionEnv, stepEnv, workflowSecrets, this.metadata.requiredEnv, namespaceSecretKeys);
  }

  /**
   * Populate the content-addressed skills cache from a git repo (clone + copy).
   * Idempotent: a cache hit is a no-op. Stores nothing on instance state — the
   * cache path is derived on demand by {@link resolveSkillsDir} via
   * {@link skillsCacheDir}, so concurrent steps can't leak or clobber it.
   *
   * Populates via a staging dir + rename so a process kill mid-copy (OOM,
   * step timeout, engine restart) can never leave a half-populated directory
   * at `cacheDir` — `existsSync(cacheDir)` above would treat that as a
   * permanent cache hit and every future run would fail to find the skill.
   */
  protected async fetchSkillsFromRepo(
    skillsDir: string,
    repoRef: string,
    commit: string,
    repoToken?: string,
  ): Promise<void> {
    const cacheDir = skillsCacheDir(repoRef, commit, skillsDir);

    // Cache hit
    if (existsSync(cacheDir)) {
      console.log(`[container-plugin] Skills cache hit for ${skillsDir} (${cacheDir})`);
      return;
    }

    // Cache miss — clone, copy into a staging dir, delete clone
    console.log(`[container-plugin] Fetching skills from ${repoRef}@${commit.slice(0, 8)} path=${skillsDir}`);
    const cloneDir = mkdtempSync(join(tmpdir(), 'mediforce-skills-clone-'));
    mkdirSync(SKILLS_CACHE_DIR, { recursive: true });
    const stagingDir = mkdtempSync(join(SKILLS_CACHE_DIR, '.staging-'));

    try {
      cloneRepoAtCommit(cloneDir, repoRef, commit, repoToken);

      const sourceDir = join(cloneDir, skillsDir);
      if (!existsSync(sourceDir)) {
        throw new Error(
          `Skills directory "${skillsDir}" not found in repo ${repoRef}@${commit.slice(0, 8)}`,
        );
      }

      const stagedSkills = join(stagingDir, 'skills');
      cpSync(sourceDir, stagedSkills, { recursive: true });

      try {
        renameSync(stagedSkills, cacheDir);
        console.log(`[container-plugin] Skills cached at ${cacheDir}`);
      } catch (error) {
        // A concurrent fetch for the same content-addressed key won the
        // race and already populated cacheDir — its content is identical
        // by construction, so this attempt is redundant, not a failure.
        if (!existsSync(cacheDir)) throw error;
        console.log(`[container-plugin] Skills cache populated concurrently for ${skillsDir} (${cacheDir})`);
      }
    } finally {
      rmSync(cloneDir, { recursive: true, force: true });
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  /**
   * Resolve the host skills directory for the current step. Three sources, most
   * specific first: skills the workflow *carries* as artifacts (materialized by
   * {@link materializeArtifacts}, no checkout involved), then the
   * `externalSkillsRepo` content-addressed cache dir (populated by
   * {@link fetchSkillsFromRepo}), then disk. Derived fresh from `this.context`
   * per call — no shared field — so a repo-mode step can't leak its cache dir
   * into a later disk-mode step, and concurrent steps can't clobber each other.
   *
   * Carried skills win over a declared repository because the definition
   * holding the files is the answer an author edited in the app. They only
   * answer for a directory the artifacts actually contain, so a workflow can
   * carry a Dockerfile and still take its skills from a repo.
   */
  protected resolveSkillsDir(skillsDir: string, resolveProjectPath: (p: string) => string): string {
    const definition = isWorkflowAgentContext(this.context)
      ? this.context.workflowDefinition
      : undefined;

    const artifacts = definition?.artifacts;
    if (artifacts !== undefined && artifacts.length > 0) {
      const prefix = `${skillsDir.replace(/\/+$/, '')}/`;
      if (artifacts.some((artifact) => artifact.path.startsWith(prefix))) {
        return join(artifactsDir(artifacts), skillsDir);
      }
    }

    const wfRepo = definition?.externalSkillsRepo;
    if (wfRepo?.url && wfRepo?.commit) {
      // Key on the raw url — must match the `repoRef` `fetchSkillsFromRepo`
      // populates with (see the call site in base-container-agent-plugin).
      return skillsCacheDir(wfRepo.url, wfRepo.commit, skillsDir);
    }
    return resolveProjectPath(skillsDir);
  }
}
