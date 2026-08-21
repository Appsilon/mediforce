'use client';

import { WORKSPACE_ICONS, WORKSPACE_ICON_KEYS, getWorkspaceIcon } from '@/lib/workspace-icons';
import { cn } from '@/lib/utils';

interface WorkspaceIconPickerProps {
  iconKey: string;
  onSelect: (iconKey: string) => void;
}

export function WorkspaceIconPicker({ iconKey, onSelect }: WorkspaceIconPickerProps) {
  const PreviewIcon = getWorkspaceIcon(iconKey);

  return (
    <div className="rounded-lg border bg-card px-4 py-5">
      <h3 className="text-sm font-semibold mb-4">Workspace icon</h3>
      <div className="flex items-center gap-6">
        {/* Preview */}
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <PreviewIcon className="h-7 w-7 text-primary" />
        </div>
        {/* Grid */}
        <div className="grid grid-cols-5 gap-1.5">
          {WORKSPACE_ICON_KEYS.map((key) => {
            const Icon = WORKSPACE_ICONS[key]!;
            return (
              <button
                key={key}
                type="button"
                title={key}
                onClick={() => onSelect(key)}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg border-2 transition-colors',
                  iconKey === key
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-transparent bg-muted text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
