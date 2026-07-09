'use client';

import * as React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

/**
 * Reviewer-facing markdown preview. Used wherever an agent or script writes
 * `presentation.md` instead of `presentation.html`. Renders inside Tailwind
 * `prose` typography so headings, lists, tables, and code blocks pick up
 * consistent Mediforce styling across every workflow.
 *
 * Security: `rehype-sanitize` strips `<script>`, inline event handlers, and
 * `javascript:` URLs by default. The renderer never injects HTML directly
 * — markdown is parsed to a React tree and rendered through DOM APIs.
 */
const MARKDOWN_COMPONENTS: Components = {
  a: ({ children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export function MarkdownPresentation({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
