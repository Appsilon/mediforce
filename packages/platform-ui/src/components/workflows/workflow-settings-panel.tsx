'use client';

import { cn } from '@/lib/utils';
import { FieldGroup, FieldRow, Section, textareaBase } from './workflow-editor/step-editor-fields';
import type { WorkflowSettingsDraft } from './workflow-settings-utils';

/**
 * Definition-level settings that have nowhere better to live. The input a
 * workflow accepts moved to the Triggers tab, which already explains and
 * previews it; environment variables stay with Secrets, and the git
 * repositories with the import flow that collects them.
 */
export function WorkflowSettingsPanel({
  draft,
  onChange,
}: {
  draft: WorkflowSettingsDraft;
  onChange: (patch: WorkflowSettingsDraft) => void;
}) {
  return (
    <div className="space-y-4">
      <Section title="Agent preamble">
        <FieldGroup>
          <FieldRow
            label="Text"
            tooltip="Added to the start of every agent prompt in this workflow. Use it for house rules, domain context and terminology."
            alignStart
          >
            <textarea
              value={draft.preamble ?? ''}
              rows={8}
              placeholder="Context and house rules for every agent step in this workflow"
              onChange={(e) => onChange({ preamble: e.target.value })}
              className={cn(textareaBase, 'placeholder:italic placeholder:text-muted-foreground/40')}
            />
          </FieldRow>
        </FieldGroup>
      </Section>
    </div>
  );
}
