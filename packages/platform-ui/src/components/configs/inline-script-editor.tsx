'use client';

import { useRef, useEffect, useCallback } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';

type Runtime = 'javascript' | 'python' | 'r' | 'bash';

const SCRIPT_SIZE_WARNING = 5_000;

function getLanguageExtension(runtime: Runtime) {
  switch (runtime) {
    case 'javascript':
      return javascript();
    case 'python':
    case 'r':
      // R is close enough to Python for basic highlighting
      return python();
    case 'bash':
      // No CodeMirror 6 bash mode — use plain text
      return [];
    default:
      return [];
  }
}

interface InlineScriptEditorProps {
  value: string;
  runtime: Runtime;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export function InlineScriptEditor({
  value,
  runtime,
  onChange,
  readOnly = false,
}: InlineScriptEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const showWarning = value.length > SCRIPT_SIZE_WARNING;

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        getLanguageExtension(runtime),
        updateListener,
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
        EditorView.theme({
          '&': { fontSize: '13px' },
          '.cm-editor': { borderRadius: '6px' },
          '.cm-scroller': { fontFamily: 'ui-monospace, monospace' },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally re-create editor when runtime changes (different language extension)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, readOnly]);

  return (
    <div className="space-y-1">
      <div
        ref={containerRef}
        className="rounded-md border overflow-hidden [&_.cm-editor]:outline-none"
      />
      {showWarning && (
        <p className="text-xs text-amber-600">
          Script is {Math.round(value.length / 1000)}KB — consider moving to a
          file in the app&apos;s scripts/ directory for easier testing and version control.
        </p>
      )}
    </div>
  );
}
