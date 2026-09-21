import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  clampToViewport,
  isFullyVisible,
  matchesRoute,
  chapterForPath,
  cardPlacement,
  type TourChapter,
} from '@/lib/tour';
import { GUIDE_CHAPTERS } from '@/lib/tour-content';

const VIEWPORT = { width: 1200, height: 800 };
const CARD = { width: 320, height: 200 };

describe('matchesRoute', () => {
  it('matches a literal segment exactly and a :param loosely', () => {
    expect(matchesRoute('/:handle/agents', '/test/agents')).toBe(true);
    expect(matchesRoute('/:handle/agents', '/other/agents')).toBe(true);
    expect(matchesRoute('/:handle/agents', '/test/tools')).toBe(false);
  });

  it('requires the same segment count unless the pattern ends in a wildcard', () => {
    expect(matchesRoute('/:handle/agents', '/test/agents/models')).toBe(false);
    expect(matchesRoute('/:handle/agents/*', '/test/agents/models')).toBe(true);
    expect(matchesRoute('/:handle/agents/*', '/test/agents')).toBe(true);
    expect(matchesRoute('/*', '/anything/at/all')).toBe(true);
  });

  it('ignores a trailing slash', () => {
    expect(matchesRoute('/:handle', '/test/')).toBe(true);
  });
});

describe('chapterForPath', () => {
  const chapters: TourChapter[] = [
    { id: 'fallback', title: 'Anywhere', match: '/*', steps: [] },
    { id: 'agents', title: 'Agents', match: '/:handle/agents', steps: [] },
    { id: 'agents-deep', title: 'Under agents', match: '/:handle/agents/*', steps: [] },
  ];

  it('picks the most specific match, not the first one declared', () => {
    expect(chapterForPath(chapters, '/test/agents')?.id).toBe('agents');
    expect(chapterForPath(chapters, '/test/agents/models')?.id).toBe('agents-deep');
  });

  it('falls back to the wildcard chapter for an unmapped route', () => {
    expect(chapterForPath(chapters, '/test/settings')?.id).toBe('fallback');
  });

  it('returns null when nothing matches', () => {
    expect(chapterForPath([chapters[1]!], '/test/settings')).toBeNull();
  });
});

describe('cardPlacement', () => {
  it('centres the card when there is no target on screen', () => {
    const placed = cardPlacement(null, VIEWPORT, CARD);
    expect(placed.placement).toBe('center');
    expect(placed.left).toBe((VIEWPORT.width - CARD.width) / 2);
  });

  it('sits below a target near the top', () => {
    const placed = cardPlacement({ top: 40, left: 100, width: 200, height: 40 }, VIEWPORT, CARD);
    expect(placed.placement).toBe('below');
    expect(placed.top).toBeGreaterThan(80);
  });

  it('flips above a target near the bottom', () => {
    const placed = cardPlacement({ top: 700, left: 100, width: 200, height: 40 }, VIEWPORT, CARD);
    expect(placed.placement).toBe('above');
    expect(placed.top).toBeLessThan(700);
  });

  it('keeps the card inside the viewport for a target at the right edge', () => {
    const placed = cardPlacement({ top: 100, left: 1150, width: 40, height: 40 }, VIEWPORT, CARD);
    expect(placed.left + CARD.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(placed.left).toBeGreaterThanOrEqual(0);
  });
});

/**
 * This package's `src`, whether vitest was started here or at the workspace
 * root — the root runner's cwd is the repository, where `src` does not exist.
 */
const SRC = [join(process.cwd(), 'src'), join(process.cwd(), 'packages/platform-ui/src')]
  .find((candidate) => existsSync(candidate));

/**
 * Every anchor name the app declares: a `data-tour="…"` attribute, or the
 * quoted literal a mapped attribute reads from — a tab strip names one anchor
 * per tab in a table rather than repeating the attribute five times.
 */
function renderedAnchors(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith('.tsx')) {
        const source = readFileSync(path, 'utf8');
        for (const match of source.matchAll(/data-tour="([a-z-]+)"/g)) found.add(match[1]!);
        for (const match of source.matchAll(/tour: '([a-z-]+)'/g)) found.add(match[1]!);
        for (const map of source.matchAll(/_TOURS[^=]*=\s*\{([^}]*)\}/g)) {
          for (const match of map[1]!.matchAll(/'([a-z-]+)'/g)) found.add(match[1]!);
        }
      }
    }
  };
  if (SRC === undefined) throw new Error('platform-ui/src not found from ' + process.cwd());
  walk(SRC);
  return found;
}

describe('clampToViewport', () => {
  it('leaves a target that already fits alone', () => {
    const box = { top: 100, left: 100, width: 200, height: 40 };
    expect(clampToViewport(box, VIEWPORT)).toEqual(box);
  });

  it('trims a target taller than the screen to what is on it', () => {
    const clamped = clampToViewport({ top: -200, left: 20, width: 400, height: 2000 }, VIEWPORT);
    expect(clamped.top).toBe(0);
    expect(clamped.height).toBe(VIEWPORT.height);
  });
});

describe('isFullyVisible', () => {
  it('is true only when every edge is on screen', () => {
    expect(isFullyVisible({ top: 10, left: 10, width: 100, height: 100 }, VIEWPORT)).toBe(true);
    expect(isFullyVisible({ top: -1, left: 10, width: 100, height: 100 }, VIEWPORT)).toBe(false);
    expect(isFullyVisible({ top: 700, left: 10, width: 100, height: 200 }, VIEWPORT)).toBe(false);
  });
});

describe('tour content', () => {
  it('explains each of the workspace screens in its own words', () => {
    const routes = [
      '/test',
      '/test/agents',
      '/test/agents/models',
      '/test/agents/new',
      '/test/tools',
      '/test/images',
      '/test/tasks',
      '/test/monitoring',
      '/test/settings',
      '/test/runs',
      '/test/workflows/new',
      '/test/workflows/etymology-checker',
      '/test/workflows/etymology-checker/runs/abc',
      '/test/workflows/etymology-checker/definitions/3',
    ];
    for (const route of routes) {
      const chapter = chapterForPath(GUIDE_CHAPTERS, route);
      expect([route, chapter?.id]).not.toEqual([route, 'anywhere']);
    }
  });

  it('gives every guide chapter a unique id', () => {
    const ids = GUIDE_CHAPTERS.map((chapter) => chapter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * A one-line chapter is worse than no chapter: it claims the screen is
   * explained. Three steps is the floor at which a chapter has said something
   * a reader could not have guessed from the page itself.
   */
  it('says at least three things about every screen it covers', () => {
    for (const chapter of GUIDE_CHAPTERS) {
      expect([chapter.id, chapter.steps.length >= 3]).toEqual([chapter.id, true]);
    }
  });

  /**
   * Ringing one element for step after step reads as the tour being stuck, and
   * it is the tell that the step is describing something it is not pointing at.
   */
  it('does not ring the same element more than twice in a chapter', () => {
    for (const chapter of GUIDE_CHAPTERS) {
      const uses = new Map<string, number>();
      for (const step of chapter.steps) {
        if (step.target === undefined) continue;
        uses.set(step.target, (uses.get(step.target) ?? 0) + 1);
      }
      for (const [target, count] of uses) {
        expect([chapter.id, target, count <= 2]).toEqual([chapter.id, target, true]);
      }
    }
  });

  it('writes steps in full sentences rather than labels', () => {
    for (const step of GUIDE_CHAPTERS.flatMap((chapter) => chapter.steps)) {
      expect([step.id, step.body.length >= 60]).toEqual([step.id, true]);
      expect([step.id, step.title.length <= 60]).toEqual([step.id, true]);
    }
  });

  it('ships a wildcard chapter so no route is left without a guide', () => {
    expect(chapterForPath(GUIDE_CHAPTERS, '/test/somewhere/nobody/mapped')).not.toBeNull();
  });

  it('points every step at a data-tour attribute that exists in the app', () => {
    const anchors = renderedAnchors();
    const targets = GUIDE_CHAPTERS.flatMap((chapter) => chapter.steps)
      .map((step) => step.target)
      .filter((target): target is string => target !== undefined);

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect([target, anchors.has(target)]).toEqual([target, true]);
  });

});
