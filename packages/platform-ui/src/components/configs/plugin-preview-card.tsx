'use client';

interface PluginMetadata {
  name: string;
  description: string;
  inputDescription: string;
  outputDescription: string;
  roles: ('executor' | 'reviewer')[];
}

interface PluginEntry {
  name: string;
  metadata?: PluginMetadata;
}

interface PluginPreviewCardProps {
  plugin: PluginEntry;
}

export function PluginPreviewCard({ plugin }: PluginPreviewCardProps) {
  const meta = plugin.metadata;

  if (!meta) {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        {plugin.name} — no metadata available
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{meta.name}</span>
        <div className="flex gap-1">
          {meta.roles.map((role) => (
            <span
              key={role}
              className="inline-flex items-center rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground"
            >
              {role}
            </span>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{meta.description}</p>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <div>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Input
          </span>
          <p className="text-xs">{meta.inputDescription}</p>
        </div>
        <div>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Output
          </span>
          <p className="text-xs">{meta.outputDescription}</p>
        </div>
      </div>
    </div>
  );
}
