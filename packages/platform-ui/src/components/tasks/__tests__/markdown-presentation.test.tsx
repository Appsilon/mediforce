import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownPresentation } from '../markdown-presentation';

describe('MarkdownPresentation', () => {
  it('renders GFM constructs — headings, lists, tables — through Tailwind prose', () => {
    const content = '# Status\n\n- one\n- two\n\n| col |\n| --- |\n| val |';

    const { container } = render(<MarkdownPresentation content={content} />);

    // Tailwind `prose` is the typography contract. Without it the rendered
    // markdown loses Mediforce-standard heading sizes and link colors.
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toMatch(/\bprose\b/);
    expect(wrapper.className).toMatch(/dark:prose-invert/);

    expect(screen.getByRole('heading', { level: 1, name: 'Status' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    // GFM tables surface as a real <table> with one cell — confirms remark-gfm wired up
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('opens links in a new tab with rel="noopener noreferrer"', () => {
    render(<MarkdownPresentation content="[issue 42](https://example.test/42)" />);

    const link = screen.getByRole('link', { name: 'issue 42' });
    expect(link.getAttribute('href')).toBe('https://example.test/42');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('strips <script> tags embedded in markdown', () => {
    const malicious = 'Hello\n\n<script>window.__pwned = true</script>\n\nworld';

    const { container } = render(<MarkdownPresentation content={malicious} />);

    expect(container.innerHTML).not.toContain('<script');
    expect(container.innerHTML.toLowerCase()).not.toContain('__pwned');
  });

  it('strips javascript: URLs from markdown links', () => {
    // rehype-sanitize defaults forbid the `javascript:` scheme on <a href>.
    // The link still renders but with the href removed.
    render(<MarkdownPresentation content="[click](javascript:alert(1))" />);

    const link = screen.getByText('click');
    expect(link.getAttribute('href')).toBeNull();
  });

  it('strips inline event handlers from raw HTML attributes', () => {
    const malicious = '<p onclick="alert(1)">click me</p>';

    const { container } = render(<MarkdownPresentation content={malicious} />);

    expect(container.innerHTML.toLowerCase()).not.toContain('onclick');
  });
});
