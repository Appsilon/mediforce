'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { GitBranch, Loader2, X } from 'lucide-react';
import type { ImportSkillsOutput } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { secondaryButtonClass } from '@/components/ui/button-styles';

const inputClass =
  'w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50';

const primaryButtonClass =
  'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:pointer-events-none';

const OUTCOME_LABEL: Record<ImportSkillsOutput['skills'][number]['outcome'], string> = {
  created: 'created',
  updated: 'updated',
  unchanged: 'already up to date',
};

/** Create or update `handle`'s Skills from the `<dir>/<name>/SKILL.md` folders
 *  of a public GitHub repository, then list what happened to each. */
export function ImportSkillsDialog({ handle, onClose }: { handle: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [repo, setRepo] = React.useState('');
  const [dir, setDir] = React.useState('skills');
  const [ref, setRef] = React.useState('');
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ImportSkillsOutput | null>(null);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setImporting(true);
    setError(null);
    try {
      const imported = await mediforce.skills.importFromRepo({
        namespace: handle,
        repo: repo.trim(),
        ...(dir.trim() === '' ? {} : { dir: dir.trim() }),
        ...(ref.trim() === '' ? {} : { ref: ref.trim() }),
      });
      setResult(imported);
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills(handle) });
      for (const skill of imported.skills) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.skill(handle, skill.id) });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (open === false && importing === false) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 text-lg font-semibold">
              <GitBranch className="h-5 w-5" />
              Import skills from git
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" disabled={importing} className="rounded-sm p-1 text-muted-foreground hover:text-foreground disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="mb-4 text-sm text-muted-foreground">
            Every <code className="font-mono">&lt;directory&gt;/&lt;name&gt;/SKILL.md</code> folder in a public GitHub
            repository becomes a skill of @{handle}. A skill already here is updated when its files differ.
          </Dialog.Description>

          {result === null ? (
            <form onSubmit={(event) => void submit(event)} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="import-skills-repo">Repository URL</label>
                <input
                  id="import-skills-repo"
                  type="url"
                  required
                  value={repo}
                  onChange={(event) => setRepo(event.target.value)}
                  disabled={importing}
                  className={inputClass}
                  placeholder="https://github.com/org/repo"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="import-skills-dir">
                  Directory <span className="font-normal">(holding the skill folders; empty for the root)</span>
                </label>
                <input
                  id="import-skills-dir"
                  value={dir}
                  onChange={(event) => setDir(event.target.value)}
                  disabled={importing}
                  className={inputClass}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="import-skills-ref">
                  Branch, tag, or commit <span className="font-normal">(optional — defaults to the URL&apos;s ref, or main)</span>
                </label>
                <input
                  id="import-skills-ref"
                  value={ref}
                  onChange={(event) => setRef(event.target.value)}
                  disabled={importing}
                  className={inputClass}
                  autoComplete="off"
                />
              </div>
              {error !== null && (
                <div role="alert" className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} disabled={importing} className={secondaryButtonClass}>Cancel</button>
                <button type="submit" disabled={importing || repo.trim() === ''} className={primaryButtonClass}>
                  {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Import
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm">
                Imported {result.skills.length} {result.skills.length === 1 ? 'skill' : 'skills'} from{' '}
                <span className="font-mono">{result.source.commit.slice(0, 8)}</span>:
              </p>
              <ul className="space-y-1 text-sm" data-testid="imported-skills">
                {result.skills.map((skill) => (
                  <li key={skill.id} className="flex justify-between gap-3">
                    <span className="font-mono">{skill.id}</span>
                    <span className="text-muted-foreground">{OUTCOME_LABEL[skill.outcome]}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <button type="button" onClick={onClose} className={secondaryButtonClass}>Done</button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
