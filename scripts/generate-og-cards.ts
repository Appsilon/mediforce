/**
 * One Open Graph card per marketing page, rendered from the page's own head.
 *
 * The pages are the source of truth: `<title>`, `<meta name="description">` and
 * `<link rel="canonical">` are read off each `.html` file under `docs/`, so a new
 * page gets a card by existing. A page missing a title or canonical fails the
 * run rather than shipping a blank card.
 *
 * Satori lays the card out and emits text as outline paths, so sharp can
 * rasterise without a font installed on the host. Fonts are committed under
 * `scripts/assets/fonts/` for the same reason: no network in the build.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import satori from 'satori';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(DOCS, 'images', 'og');
const FONTS = path.join(ROOT, 'scripts', 'assets', 'fonts');

const WIDTH = 1200;
const HEIGHT = 630;
const CARD_BASE = 'https://mediforce.ai/images/og';
const LLMS = 'llms.txt';

/** Written as in `docs/theme.css`, converted here so the two cannot drift. */
const TOKENS = {
  ground: 'hsl(0 0% 98%)',
  dot: 'hsl(214.3 31.8% 88%)',
  accent: 'hsl(161 94% 30%)',
  ink: 'hsl(222.2 84% 4.9%)',
  muted: 'hsl(215.4 16.3% 46.9%)',
};

/** Satori's colour parser does not take space-separated `hsl()`. */
function hslToHex(value: string): string {
  const [h, s, l] = value
    .replace(/hsl\(|\)|%/g, '')
    .split(/[\s,]+/)
    .map(Number);
  const chroma = ((1 - Math.abs((2 * l) / 100 - 1)) * s) / 100;
  const sector = h / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] = (
    [
      [chroma, x, 0],
      [x, chroma, 0],
      [0, chroma, x],
      [0, x, chroma],
      [x, 0, chroma],
      [chroma, 0, x],
    ] as const
  )[Math.floor(sector) % 6];
  const m = l / 100 - chroma / 2;
  const channel = (c: number) =>
    Math.round((c + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

const C = Object.fromEntries(
  Object.entries(TOKENS).map(([k, v]) => [k, hslToHex(v)]),
) as Record<keyof typeof TOKENS, string>;

interface Page {
  file: string;
  slug: string;
  title: string;
  description: string;
  url: string;
}

async function htmlFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await htmlFiles(full)));
    } else if (entry.name.endsWith('.html')) {
      found.push(full);
    }
  }
  return found;
}

function extract(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match ? match[1].trim() : null;
}

function decode(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&middot;/g, '·')
    .replace(/\s+/g, ' ');
}

/** The card already shows the brand, so the title does not repeat it. */
function stripBrand(title: string): string {
  return title
    .replace(/\s*[-–—|·]\s*Mediforce\s*$/i, '')
    .replace(/^\s*Mediforce\s*[-–—|·]\s*/i, '')
    .trim();
}

function displayUrl(url: string): string {
  const { host, pathname } = new URL(url);
  return pathname === '/' ? host : host + pathname;
}

function slugFor(url: string): string {
  const pathname = new URL(url).pathname.replace(/^\/|\/$/g, '').replace(/\.html$/, '');
  return pathname === '' ? 'index' : pathname.replace(/\//g, '-');
}

async function collectPages(): Promise<Page[]> {
  const pages: Page[] = [];
  for (const file of (await htmlFiles(DOCS)).sort()) {
    const relative = path.relative(ROOT, file);
    const html = await readFile(file, 'utf-8');

    const title = extract(html, /<title>([\s\S]*?)<\/title>/i);
    const url = extract(html, /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i);
    const description = extract(html, /<meta[^>]+name="description"[^>]+content="([^"]*)"/i);

    if (title === null) throw new Error(`${relative}: no <title>`);
    if (url === null) throw new Error(`${relative}: no <link rel="canonical">`);

    const slug = slugFor(url);

    // The card is generated and the tags that describe it are hand-written, so
    // the run holds them to each other. Without this, editing a `<title>` and
    // forgetting its `og:title` ships a share preview that contradicts the page.
    const mustMatch: [string, string | null, string][] = [
      ['og:image', extract(html, /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i), `${CARD_BASE}/${slug}.png`],
      ['og:url', extract(html, /<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i), url],
      ['og:title', extract(html, /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i), title],
      ['twitter:title', extract(html, /<meta[^>]+name="twitter:title"[^>]+content="([^"]*)"/i), title],
    ];
    const topic = title.replace(/\s*\|\s*Mediforce\s*$/, '').trim();
    for (const tag of ['og:image:alt', 'twitter:image:alt'] as const) {
      const attr = tag.startsWith('og:') ? 'property' : 'name';
      mustMatch.push([
        tag,
        extract(html, new RegExp(`<meta[^>]+${attr}="${tag}"[^>]+content="([^"]*)"`, 'i')),
        `${topic} — Mediforce social card`,
      ]);
    }
    if (description !== null) {
      mustMatch.push([
        'og:description',
        extract(html, /<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i),
        description,
      ]);
    }
    for (const [tag, found, want] of mustMatch) {
      if (found === null) throw new Error(`${relative}: no ${tag}`);
      if (found !== want) throw new Error(`${relative}: ${tag} is "${found}", page says "${want}"`);
    }

    pages.push({
      file: relative,
      slug,
      title: stripBrand(decode(title)),
      description: description === null ? '' : decode(description),
      url,
    });
  }
  return pages;
}

function card(page: Page, mark: string, appsilon: string, dots: string) {
  const isHome = page.slug === 'index';

  return {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px',
        backgroundColor: C.ground,
        backgroundImage: `url("${dots}")`,
        backgroundRepeat: 'repeat',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { display: 'flex', alignItems: 'center', gap: '20px' },
            children: [
              { type: 'img', props: { src: mark, height: isHome ? 108 : 64 } },
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: 'Space Grotesk',
                    fontSize: isHome ? 92 : 54,
                    letterSpacing: '-0.03em',
                    color: C.accent,
                  },
                  children: 'Mediforce',
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', gap: '20px' },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: 'Space Grotesk',
                    fontSize: isHome ? 46 : 62,
                    lineHeight: 1.15,
                    letterSpacing: '-0.025em',
                    color: C.muted,
                    maxWidth: '95%',
                  },
                  children: page.title,
                },
              },
              page.description
                ? {
                    type: 'div',
                    props: {
                      style: {
                        fontFamily: 'Inter',
                        fontSize: 27,
                        lineHeight: 1.45,
                        color: C.muted,
                        maxWidth: '86%',
                      },
                      children: page.description,
                    },
                  }
                : null,
            ].filter(Boolean),
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: { fontFamily: 'Inter', fontSize: 25, color: C.muted },
                  children: displayUrl(page.url),
                },
              },
              { type: 'img', props: { src: appsilon, height: 30 } },
            ],
          },
        },
      ],
    },
  };
}

async function main() {
  const [grotesk, inter] = await Promise.all([
    readFile(path.join(FONTS, 'SpaceGrotesk-Bold.ttf')),
    readFile(path.join(FONTS, 'Inter-Regular.ttf')),
  ]);

  // Trimmed at build time so the mark tracks docs/logo.png rather than a copy.
  const markPng = await sharp(path.join(DOCS, 'logo.png')).trim().png().toBuffer();
  const mark = `data:image/png;base64,${markPng.toString('base64')}`;

  const appsilonSvg = await readFile(path.join(DOCS, 'images', 'appsilon-logo.svg'));
  const appsilon = `data:image/svg+xml;base64,${appsilonSvg.toString('base64')}`;

  const dotTile =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">` +
    `<circle cx="12" cy="12" r="1" fill="${C.dot}"/></svg>`;
  const dots = `data:image/svg+xml;base64,${Buffer.from(dotTile).toString('base64')}`;

  const pages = await collectPages();

  // llms.txt is written by hand on purpose - it is a curated guide, not a dump
  // of titles - but a page missing from it is invisible to the assistants it
  // exists for, and nothing else would notice.
  const llms = await readFile(path.join(DOCS, LLMS), 'utf-8');
  const absent = pages.filter((page) => llms.includes(page.url) === false);
  if (absent.length > 0) {
    throw new Error(`${LLMS} does not list: ${absent.map((p) => p.url).join(', ')}`);
  }
  await mkdir(OUT, { recursive: true });

  for (const page of pages) {
    const svg = await satori(card(page, mark, appsilon, dots) as never, {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: 'Space Grotesk', data: grotesk, weight: 700, style: 'normal' },
        { name: 'Inter', data: inter, weight: 400, style: 'normal' },
      ],
    });

    const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
    await writeFile(path.join(OUT, `${page.slug}.png`), png);

    const kb = Math.round(png.length / 1024);
    console.log(`[og] ${page.slug}.png  ${String(kb).padStart(3)} KB  ${page.file}`);
  }

  console.log(`[og] ${pages.length} cards -> ${path.relative(ROOT, OUT)}`);
}

main().catch((error) => {
  console.error(`[og] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
