'use client';

import React, { useState } from 'react';
import { AlertTriangle, Box, FileCode, GitBranch } from 'lucide-react';
import type { ContainerConfig } from '@mediforce/platform-core';
import { FieldRow, PillToggle, inputBase, inputBaseMono, selectBase } from './step-editor-fields';
import { ImageOptions, offersValue } from './image-options';
import type { ImagePicker } from './image-picker-options';
import {
  carriedDockerfileOptions,
  clearForMode,
  deriveImageSourceMode,
  unusedFieldsForMode,
  type ImageSourceDefinition,
  type ImageSourceMode,
} from './image-source-mode';

const MODE_OPTIONS: { value: ImageSourceMode; label: string; icon: React.ElementType }[] = [
  { value: 'ready', label: 'Ready image', icon: Box },
  { value: 'carried', label: 'Built from workflow files', icon: FileCode },
  { value: 'repo', label: 'Built from a git repo', icon: GitBranch },
];

const MODE_HINT: Record<ImageSourceMode, string> = {
  ready: 'An image the platform already offers. Images you build, upload or publish under Workspace → Images appear here.',
  carried: "A Dockerfile this workflow carries in its files. It is built on the first run, and rebuilt whenever the files inside its context change — no repository involved.",
  repo: 'A Dockerfile in a git repository, built at the commit you pin.',
};

/** What `image` means in a build mode, which is not what it means in `ready`:
 *  the tag the built image gets, not an image to run. */
const BUILD_TAG_TIP =
  'Tag the built image gets, e.g. "my-agent:latest". Leave empty for a tag derived from the build inputs. A name this workspace published (<workspace>/<name>) is refused: those belong to the Image Catalog and a build must not replace one.';

const DOCKERFILE_TIP: Record<'carried' | 'repo', string> = {
  carried: 'A Dockerfile among the files this workflow carries, by its path from their root.',
  repo: 'Path to a Dockerfile in the repository — from its root, or from the context when one is set.',
};

const CONTEXT_TIP: Record<'carried' | 'repo', string> = {
  carried: 'Directory to build from, from the root of the carried files. Empty means all of them, so a Dockerfile in a subdirectory can still COPY its siblings. Narrowing it means only those files rebuild the image.',
  repo: 'Build context directory in the repository, e.g. "." for its root. Empty means the Dockerfile\'s own directory, where everything it COPYs must sit beside it.',
};

/**
 * The image half of a container step, as one choice instead of six fields.
 *
 * The three modes are the three things the runtime actually does
 * (`deriveImageSourceMode`), so the editor cannot offer a combination that
 * resolves to something else. Shared by agent and script steps, which differ
 * only in the field prefix and in what a blank image means.
 */
export function ImageSourceFields({
  prefix,
  config,
  definition,
  picker,
  onChange,
  blankOptionLabel,
  imageWarning,
  pickerValue = (image) => image,
}: {
  prefix: 'agent' | 'script';
  config: ContainerConfig | undefined;
  definition: ImageSourceDefinition | undefined;
  picker: ImagePicker;
  onChange: (patch: Partial<ContainerConfig>) => void;
  /** What an empty image means for this executor — registration's fallback. */
  blankOptionLabel: string;
  imageWarning?: string;
  pickerValue?: (image: string) => string;
}) {
  // What the step says, and what the author has since asked for. A mode is not
  // stored on the definition, so "built from a git repo" is invisible until a
  // repo is typed — the fields have to be on screen for that to be possible at
  // all. The step editor remounts this per step, so the choice never outlives
  // the step it was made for.
  const [chosen, setChosen] = useState<ImageSourceMode | null>(null);
  const mode = chosen ?? deriveImageSourceMode(config, definition);
  const unused = unusedFieldsForMode(mode, config, definition);
  const skillsRepo = definition?.externalSkillsRepo;
  const inheritsSkillsRepo =
    mode === 'repo' &&
    (config?.repo ?? '') === '' &&
    typeof skillsRepo?.url === 'string' && skillsRepo.url.length > 0;
  // Hidden by default: an image worth running is one the catalog describes, and
  // the picker keeps a value it does not recognise rather than dropping it
  // (ADR-0022 decision 5). The escape hatch stays for an image nobody has
  // catalogued yet — an imported package's, most often.
  const [naming, setNaming] = useState(false);

  const dockerfileOptions = carriedDockerfileOptions(definition, config?.dockerfile);

  return (
    <>
      <FieldRow label="Image source">
        <PillToggle
          value={mode}
          onChange={(next) => {
            if (next === mode) return;
            setChosen(next);
            onChange(clearForMode(next));
          }}
          options={MODE_OPTIONS}
        />
      </FieldRow>
      <p className="text-[11px] leading-relaxed text-muted-foreground px-1 -mt-2">{MODE_HINT[mode]}</p>

      {unused.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
          <AlertTriangle className="h-3 w-3 mt-0.5 text-amber-500 shrink-0" strokeWidth={2} />
          <div className="text-[11px] text-amber-700 dark:text-amber-300 space-y-1">
            <p>
              This step also sets {unused.map((field) => `${prefix}.${field}`).join(', ')}, which this
              source does not use. The run ignores {unused.length === 1 ? 'it' : 'them'}.
            </p>
            <button
              type="button"
              className="font-medium underline cursor-pointer"
              onClick={() => {
                onChange(Object.fromEntries(unused.map((field) => [field, undefined])));
              }}
            >
              Clear {unused.length === 1 ? 'it' : 'them'}
            </button>
          </div>
        </div>
      )}

      {mode === 'ready' && (
        <>
          <FieldRow label={`${prefix}.image`}>
            {picker.hasSource && naming === false ? (
              <select
                aria-label="Known Docker image"
                value={pickerValue(config?.image ?? '')}
                onChange={(event) => { onChange({ image: event.target.value || undefined }); }}
                className={selectBase}
              >
                <option value="">{blankOptionLabel}</option>
                <ImageOptions groups={picker.groups} normalize={pickerValue} />
                {config?.image !== undefined && config.image !== '' && offersValue(picker.groups, config.image, pickerValue) === false && (
                  <option value={config.image}>{config.image}</option>
                )}
              </select>
            ) : (
              <input
                aria-label="Custom Docker image"
                value={config?.image ?? ''}
                onChange={(event) => { onChange({ image: event.target.value || undefined }); }}
                className={inputBaseMono}
              />
            )}
          </FieldRow>
          {picker.hasSource && (
            <button
              type="button"
              className="text-[11px] text-muted-foreground underline px-1 -mt-2 w-fit cursor-pointer"
              onClick={() => { setNaming(naming === false); }}
            >
              {naming ? 'Pick from the catalog' : 'Name an image the catalog does not list'}
            </button>
          )}
          {imageWarning !== undefined && imageWarning !== '' && (
            <div className="flex items-center gap-1.5 px-3 -mt-1">
              <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" strokeWidth={2} />
              <span className="text-[11px] text-amber-600 dark:text-amber-400">{imageWarning}</span>
            </div>
          )}
        </>
      )}

      {mode === 'carried' && (
        <>
          <FieldRow label={`${prefix}.dockerfile`} tooltip={DOCKERFILE_TIP.carried}>
            {dockerfileOptions.length > 0 ? (
              <select
                aria-label="Carried Dockerfile"
                value={config?.dockerfile ?? ''}
                onChange={(event) => { onChange({ dockerfile: event.target.value || undefined }); }}
                className={selectBase}
              >
                <option value="">Select a carried Dockerfile…</option>
                {dockerfileOptions.map((path) => (
                  <option key={path} value={path}>{path}</option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                This workflow carries no Dockerfile. Add one to its files, then pick it here.
              </p>
            )}
          </FieldRow>

          <FieldRow label={`${prefix}.context`} tooltip={CONTEXT_TIP.carried}>
            <input
              value={config?.context ?? ''}
              onChange={(event) => { onChange({ context: event.target.value || undefined }); }}
              placeholder="all carried files"
              className={inputBaseMono}
            />
          </FieldRow>

          <BuildTagField prefix={prefix} config={config} onChange={onChange} />
        </>
      )}

      {mode === 'repo' && (
        <>
          <FieldRow label={`${prefix}.dockerfile`} tooltip={DOCKERFILE_TIP.repo}>
            <input
              value={config?.dockerfile ?? ''}
              onChange={(event) => { onChange({ dockerfile: event.target.value || undefined }); }}
              className={inputBaseMono}
            />
          </FieldRow>

          <FieldRow label={`${prefix}.context`} tooltip={CONTEXT_TIP.repo}>
            <input
              value={config?.context ?? ''}
              onChange={(event) => { onChange({ context: event.target.value || undefined }); }}
              placeholder="the Dockerfile's own directory"
              className={inputBaseMono}
            />
          </FieldRow>

          <FieldRow label={`${prefix}.repo`} tooltip="Git repository the Dockerfile is read from.">
            <input
              value={config?.repo ?? ''}
              onChange={(event) => { onChange({ repo: event.target.value || undefined }); }}
              placeholder={inheritsSkillsRepo ? skillsRepo?.url : undefined}
              className={inputBase}
            />
          </FieldRow>

          <FieldRow label={`${prefix}.commit`} tooltip="Commit to build. A build is pinned, so an unpinned repository is never built twice the same way.">
            <input
              value={config?.commit ?? ''}
              onChange={(event) => { onChange({ commit: event.target.value || undefined }); }}
              placeholder={inheritsSkillsRepo ? skillsRepo?.commit : undefined}
              className={inputBaseMono}
            />
          </FieldRow>

          {inheritsSkillsRepo && (
            <p className="text-[11px] leading-relaxed text-muted-foreground px-1 -mt-2">
              Left empty, this builds from the workflow&apos;s skills repository — {skillsRepo?.url} at{' '}
              {(skillsRepo?.commit ?? '').slice(0, 8)}.
            </p>
          )}

          <FieldRow label={`${prefix}.repoAuth`} tooltip="Name of a workflow secret holding the token for cloning a private repository.">
            <input
              value={config?.repoAuth ?? ''}
              onChange={(event) => { onChange({ repoAuth: event.target.value || undefined }); }}
              className={inputBaseMono}
            />
          </FieldRow>

          <BuildTagField prefix={prefix} config={config} onChange={onChange} />
        </>
      )}
    </>
  );
}

function BuildTagField({
  prefix,
  config,
  onChange,
}: {
  prefix: 'agent' | 'script';
  config: ContainerConfig | undefined;
  onChange: (patch: Partial<ContainerConfig>) => void;
}) {
  return (
    <FieldRow label={`${prefix}.image — build tag`} tooltip={BUILD_TAG_TIP}>
      <input
        aria-label="Build tag"
        value={config?.image ?? ''}
        onChange={(event) => { onChange({ image: event.target.value || undefined }); }}
        placeholder="derived from the build inputs"
        className={inputBaseMono}
      />
    </FieldRow>
  );
}
