'use client';

import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { json as jsonLang } from '@codemirror/lang-json';
import { tags } from '@lezer/highlight';
import { cn } from '@/lib/utils';

/**
 * The one CodeMirror setup in the editor. Extracted from the source panel when
 * the files panel needed the same thing without JSON highlighting, so the
 * theme, the font and the external-update handling stay in one place.
 */
export function CodeEditor({
  value,
  onChange,
  language = 'json',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  /** `json` highlights; `text` is for a workflow file, which can be anything. */
  language?: 'json' | 'text';
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const externalUpdateRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        ...(language === 'json' ? [jsonLang()] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !externalUpdateRef.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': { fontSize: '11px', height: 'auto' },
          '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'visible' },
          '.cm-content': { padding: '8px 0' },
          '.cm-gutters': { borderRight: '1px solid var(--border)', background: 'transparent', color: 'hsl(var(--muted-foreground))', fontSize: '10px' },
          '.cm-activeLineGutter': { background: 'transparent' },
          '.cm-tok-key':     { color: 'hsl(var(--primary))', fontWeight: '500' },
          '.cm-tok-string':  { color: 'hsl(var(--color-status-warn))' },
          '.cm-tok-number':  { color: 'hsl(38 75% 45%)' },
          '.cm-tok-bool':    { color: 'hsl(var(--color-status-ok))' },
          '.cm-tok-null':    { color: 'hsl(var(--muted-foreground))' },
          '.cm-tok-comment': { color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' },
          '.cm-tok-punct':   { color: 'hsl(var(--muted-foreground) / 0.6)' },
        }),
        syntaxHighlighting(HighlightStyle.define([
          { tag: tags.propertyName,              class: 'cm-tok-key' },
          { tag: tags.string,                    class: 'cm-tok-string' },
          { tag: tags.number,                    class: 'cm-tok-number' },
          { tag: [tags.bool, tags.atom],         class: 'cm-tok-bool' },
          { tag: tags.null,                      class: 'cm-tok-null' },
          { tag: tags.comment,                   class: 'cm-tok-comment' },
          { tag: [tags.separator, tags.bracket], class: 'cm-tok-punct' },
        ])),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    externalUpdateRef.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    externalUpdateRef.current = false;
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'rounded-lg border overflow-hidden [&_.cm-editor]:outline-none [&_.cm-editor.cm-focused]:outline-none',
        className,
      )}
    />
  );
}
