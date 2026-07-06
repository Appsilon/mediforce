import { describe, it, expect } from 'vitest';
import { selectViewer, TEXT_PREVIEW_MAX_BYTES } from '../output-file-viewer';

const SMALL = 1024;

describe('selectViewer — viewer per extension', () => {
  it('maps markdown extensions to the markdown viewer', () => {
    expect(selectViewer('report.md', SMALL).viewer).toBe('markdown');
    expect(selectViewer('report.markdown', SMALL).viewer).toBe('markdown');
  });

  it('maps html extensions to the html viewer', () => {
    expect(selectViewer('index.html', SMALL).viewer).toBe('html');
    expect(selectViewer('index.htm', SMALL).viewer).toBe('html');
  });

  it('maps raster images to the image viewer', () => {
    for (const name of ['fig.png', 'fig.jpg', 'fig.jpeg', 'fig.gif', 'fig.webp']) {
      expect(selectViewer(name, SMALL).viewer).toBe('image');
    }
  });

  it('maps svg to its own viewer (rendered as an image, not inline)', () => {
    expect(selectViewer('plot.svg', SMALL).viewer).toBe('svg');
  });

  it('maps csv and tsv to the csv viewer', () => {
    expect(selectViewer('table.csv', SMALL).viewer).toBe('csv');
    expect(selectViewer('table.tsv', SMALL).viewer).toBe('csv');
  });

  it('maps plain-text families to the text viewer', () => {
    for (const name of ['notes.txt', 'notes.text', 'run.log', 'data.json']) {
      expect(selectViewer(name, SMALL).viewer).toBe('text');
    }
  });

  it('maps pdf to the pdf viewer', () => {
    expect(selectViewer('listing.pdf', SMALL).viewer).toBe('pdf');
  });
});

describe('selectViewer — download fallback', () => {
  it('falls back to download for deferred/unknown types', () => {
    for (const name of ['doc.rtf', 'sheet.xlsx', 'sheet.xls', 'archive.zip', 'noext']) {
      const result = selectViewer(name, SMALL);
      expect(result.viewer).toBe('download');
      expect(result.reason).toBe('unsupported');
    }
  });
});

describe('selectViewer — size guard', () => {
  it('degrades text-family files over the cap to download (too-large)', () => {
    const tooBig = TEXT_PREVIEW_MAX_BYTES + 1;
    for (const name of ['report.md', 'index.html', 'table.csv', 'notes.txt']) {
      const result = selectViewer(name, tooBig);
      expect(result.viewer).toBe('download');
      expect(result.reason).toBe('too-large');
    }
  });

  it('renders text-family files at exactly the cap', () => {
    expect(selectViewer('report.md', TEXT_PREVIEW_MAX_BYTES).viewer).toBe('markdown');
  });

  it('does NOT size-guard images, svg, or pdf (browser streams the blob)', () => {
    const huge = TEXT_PREVIEW_MAX_BYTES * 20;
    expect(selectViewer('fig.png', huge).viewer).toBe('image');
    expect(selectViewer('plot.svg', huge).viewer).toBe('svg');
    expect(selectViewer('listing.pdf', huge).viewer).toBe('pdf');
  });
});

describe('selectViewer — extension parsing', () => {
  it('is case-insensitive on the extension', () => {
    expect(selectViewer('REPORT.MD', SMALL).viewer).toBe('markdown');
    expect(selectViewer('FIG.PNG', SMALL).viewer).toBe('image');
  });

  it('uses the last segment of a nested path', () => {
    expect(selectViewer('sub/dir/plot.svg', SMALL).viewer).toBe('svg');
  });

  it('uses the final extension of a multi-dot name', () => {
    expect(selectViewer('adsl.final.csv', SMALL).viewer).toBe('csv');
  });
});
