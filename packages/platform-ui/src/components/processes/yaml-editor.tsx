'use client';

import * as React from 'react';
import { CheckCircle, XCircle, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { saveDefinition } from '@/app/actions/definitions';
import type { SaveDefinitionResult } from '@/app/actions/definitions';
import { useAuth } from '@/contexts/auth-context';
import { useAllUserNamespaces } from '@/hooks/use-all-user-namespaces';

interface YamlEditorProps {
  initialValue?: string;
  namespace?: string;
  onNamespaceChange?: (ns: string) => void;
  onSaved?: (name: string, version: string) => void;
}

export function YamlEditor({ initialValue = '', namespace, onNamespaceChange, onSaved }: YamlEditorProps) {
  const { firebaseUser } = useAuth();
  const { namespaces, loading: namespacesLoading } = useAllUserNamespaces(firebaseUser?.uid);

  const [yaml, setYaml] = React.useState(initialValue);
  const [state, setState] = React.useState<
    | { status: 'idle' }
    | { status: 'saving' }
    | { status: 'saved'; name: string; version: string }
    | { status: 'error'; message: string }
  >({ status: 'idle' });

  // Auto-select first namespace when loaded
  React.useEffect(() => {
    if (namespaces.length > 0 && (namespace === undefined || namespace === '')) {
      onNamespaceChange?.(namespaces[0].handle);
    }
  }, [namespaces, namespace, onNamespaceChange]);

  // Reset when initialValue changes (e.g. version switched)
  React.useEffect(() => {
    setYaml(initialValue);
    setState({ status: 'idle' });
  }, [initialValue]);

  const handleSave = async () => {
    setState({ status: 'saving' });
    const result: SaveDefinitionResult = await saveDefinition(yaml, namespace);
    if (result.success) {
      setState({ status: 'saved', name: result.name, version: result.version });
      onSaved?.(result.name, result.version);
    } else {
      setState({ status: 'error', message: result.error });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="namespace-select" className="text-sm font-medium text-muted-foreground">
          Owner
        </label>
        <select
          id="namespace-select"
          value={namespace ?? ''}
          onChange={(e) => onNamespaceChange?.(e.target.value)}
          disabled={namespacesLoading || namespaces.length === 0}
          className={cn(
            'w-48 rounded-md border bg-background px-3 py-1.5 text-sm outline-none',
            'focus:ring-1 focus:ring-ring focus:border-ring',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {namespacesLoading ? (
            <option value="">Loading...</option>
          ) : namespaces.length === 0 ? (
            <option value="">No namespaces</option>
          ) : (
            namespaces.map((ns) => (
              <option key={ns.handle} value={ns.handle}>
                {ns.displayName ?? ns.handle} (@{ns.handle})
              </option>
            ))
          )}
        </select>
      </div>

      <textarea
        value={yaml}
        onChange={(e) => {
          setYaml(e.target.value);
          if (state.status !== 'idle') setState({ status: 'idle' });
        }}
        spellCheck={false}
        className={cn(
          'h-[28rem] w-full resize-none rounded-md border bg-muted/30 p-4 font-mono text-xs leading-relaxed outline-none',
          'focus:ring-1 focus:ring-ring focus:border-ring',
          state.status === 'error' && 'border-destructive focus:ring-destructive',
        )}
        placeholder={PLACEHOLDER}
      />

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={state.status === 'saving' || !yaml.trim()}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <Save className="h-3.5 w-3.5" />
          {state.status === 'saving' ? 'Saving…' : 'Save Definition'}
        </button>

        {state.status === 'saved' && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" />
            Saved — <span className="font-mono">{state.name} v{state.version}</span>
          </span>
        )}

        {state.status === 'error' && (
          <span className="flex items-center gap-1.5 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" />
            {state.message}
          </span>
        )}
      </div>
    </div>
  );
}

const PLACEHOLDER = `name: my-process
version: 1.0.0
description: What this process does

triggers:
  - type: manual
    name: start

steps:
  - id: step-1
    name: First Step
    type: agent
    plugin: my-plugin

  - id: done
    name: Done
    type: terminal

transitions:
  - from: step-1
    to: done
`;
