/**
 * Converts markdown report to a standalone HTML file.
 * Zero external dependencies — uses a simple markdown-to-HTML converter
 * and inline CSS. The output is a single self-contained file.
 */

import type { RunReportData } from './assemble-report.js';
import { renderMarkdown } from './render-markdown.js';

// Minimal markdown to HTML converter — handles the subset we generate
function markdownToHtml(md: string): string {
  let html = md;

  // Escape HTML entities in non-code blocks (we'll handle code blocks separately)
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const index = codeBlocks.length;
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    codeBlocks.push(
      `<pre class="code-block"><code class="language-${lang || 'text'}">${escaped}</code></pre>`,
    );
    return `__CODE_BLOCK_${index}__`;
  });

  // Details/summary (pass through as-is — already HTML)
  // No transformation needed

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  // Merge adjacent blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

  // Tables
  html = html.replace(
    /(?:^\|.+\|$\n)+/gm,
    (tableBlock) => {
      const rows = tableBlock.trim().split('\n');
      if (rows.length < 2) return tableBlock;

      let tableHtml = '<table>';
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        // Skip separator row (|---|---|)
        if (/^\|[\s-:|]+\|$/.test(row)) continue;

        const cells = row
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        const tag = i === 0 ? 'th' : 'td';
        const rowClass = i === 0 ? ' class="table-header"' : '';
        tableHtml += `<tr${rowClass}>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
      }
      tableHtml += '</table>';
      return tableHtml;
    },
  );

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );

  // Unordered lists
  html = html.replace(/(?:^- .+$\n?)+/gm, (listBlock) => {
    const items = listBlock
      .trim()
      .split('\n')
      .map((line) => {
        // Handle nested items (indented with spaces)
        const indent = line.match(/^(\s*)-/);
        const content = line.replace(/^\s*- /, '');
        if (indent && indent[1].length >= 2) {
          return `<li class="nested">${content}</li>`;
        }
        return `<li>${content}</li>`;
      });
    return `<ul>${items.join('')}</ul>`;
  });

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Paragraphs — wrap remaining text lines
  html = html.replace(/^(?!<[a-z/]|__CODE)(.+)$/gm, '<p>$1</p>');

  // Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    html = html.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/\n{3,}/g, '\n\n');

  return html;
}

const CSS = `
  :root {
    --bg: #ffffff;
    --bg-card: #f8f9fa;
    --bg-code: #f1f3f5;
    --text: #212529;
    --text-muted: #868e96;
    --border: #dee2e6;
    --primary: #228be6;
    --green: #40c057;
    --red: #fa5252;
    --amber: #fab005;
    --blue: #339af0;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1a1b1e;
      --bg-card: #25262b;
      --bg-code: #2c2e33;
      --text: #c1c2c5;
      --text-muted: #909296;
      --border: #373a40;
      --primary: #4dabf7;
      --green: #51cf66;
      --red: #ff6b6b;
      --amber: #fcc419;
      --blue: #74c0fc;
    }
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  h1 { font-size: 1.75rem; margin-bottom: 1rem; }
  h2 { font-size: 1.35rem; margin: 2rem 0 0.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
  h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }

  p { margin: 0.25rem 0; }

  a { color: var(--primary); text-decoration: none; }
  a:hover { text-decoration: underline; }

  blockquote {
    border-left: 4px solid var(--amber);
    background: var(--bg-card);
    padding: 0.75rem 1rem;
    margin: 0.75rem 0;
    border-radius: 0 6px 6px 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5rem 0;
    font-size: 0.9rem;
  }

  th, td {
    text-align: left;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  th { font-weight: 600; }

  .table-header th {
    background: var(--bg-card);
  }

  code {
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 0.85em;
    background: var(--bg-code);
    padding: 0.15em 0.4em;
    border-radius: 3px;
  }

  .code-block {
    background: var(--bg-code);
    border-radius: 6px;
    padding: 1rem;
    overflow-x: auto;
    margin: 0.5rem 0;
    font-size: 0.8rem;
    line-height: 1.5;
  }

  .code-block code {
    background: none;
    padding: 0;
  }

  ul { padding-left: 1.5rem; margin: 0.25rem 0; }
  li { margin: 0.15rem 0; }
  li.nested { margin-left: 1rem; }

  details {
    margin: 0.5rem 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  summary {
    cursor: pointer;
    padding: 0.5rem 0.75rem;
    background: var(--bg-card);
    font-weight: 500;
    font-size: 0.9rem;
  }

  details > :not(summary) {
    padding: 0 0.75rem 0.75rem;
  }

  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 2rem 0;
  }

  strong { font-weight: 600; }
  em { font-style: italic; color: var(--text-muted); }

  @media print {
    body { max-width: 100%; padding: 1rem; }
    details { border: none; }
    details[open] summary { display: none; }
    details > * { padding: 0 !important; }
    a { color: var(--text); }
    a::after { content: " (" attr(href) ")"; font-size: 0.8em; color: var(--text-muted); }
  }
`;

export function renderHtml(report: RunReportData): string {
  const md = renderMarkdown(report);
  const bodyHtml = markdownToHtml(md);
  const title = `${report.definitionName} \u2014 Run Report`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
