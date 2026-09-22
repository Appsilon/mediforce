import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { isAppsilonEmail, offersDemo } from '@/lib/demo';
import { DEMO_SCENARIOS } from '@/lib/demo-content';
import { matchesRoute } from '@/lib/tour';

const SRC = [join(process.cwd(), 'src'), join(process.cwd(), 'packages/platform-ui/src')]
  .find((candidate) => existsSync(candidate));

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

describe('isAppsilonEmail', () => {
  it('admits an Appsilon address whatever its casing', () => {
    expect(isAppsilonEmail('deepansh.khurana@appsilon.com')).toBe(true);
    expect(isAppsilonEmail('Someone@Appsilon.COM')).toBe(true);
  });

  it('rejects everyone else, including a lookalike domain', () => {
    expect(isAppsilonEmail('test@mediforce.dev')).toBe(false);
    expect(isAppsilonEmail('someone@notappsilon.com')).toBe(false);
    expect(isAppsilonEmail('someone@appsilon.com.evil.io')).toBe(false);
    expect(isAppsilonEmail(null)).toBe(false);
  });
});

describe('offersDemo', () => {
  it('keeps the Appsilon rule when demo mode is off', () => {
    expect(offersDemo('someone@appsilon.com', { demoModeEnabled: false })).toBe(true);
    expect(offersDemo('test@mediforce.dev', { demoModeEnabled: false })).toBe(false);
  });

  it('opens to anyone under demo mode, which is how dev:mock walks it', () => {
    expect(offersDemo('test@mediforce.dev', { demoModeEnabled: true })).toBe(true);
    expect(offersDemo(null, { demoModeEnabled: true })).toBe(true);
  });
});

describe('demo scenarios', () => {
  it('ships four, each with a unique id', () => {
    expect(DEMO_SCENARIOS).toHaveLength(4);
    const ids = DEMO_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('opens every scenario on a route, so it knows where to send you first', () => {
    for (const scenario of DEMO_SCENARIOS) {
      expect([scenario.id, scenario.steps[0]?.route !== undefined]).toEqual([scenario.id, true]);
    }
  });

  it('points every step at a data-tour attribute that exists in the app', () => {
    const anchors = renderedAnchors();
    for (const scenario of DEMO_SCENARIOS) {
      for (const step of scenario.steps) {
        if (step.target === undefined) continue;
        expect([step.id, anchors.has(step.target)]).toEqual([step.id, true]);
      }
    }
  });

  it('writes routes the matcher can actually resolve', () => {
    for (const scenario of DEMO_SCENARIOS) {
      for (const step of scenario.steps) {
        if (step.route === undefined) continue;
        const sample = step.route.replace(/:[a-zA-Z]+/g, 'x');
        expect([step.id, matchesRoute(step.route, sample)]).toEqual([step.id, true]);
      }
    }
  });

  it('keeps the steps substantial and their titles short', () => {
    for (const scenario of DEMO_SCENARIOS) {
      expect([scenario.id, scenario.steps.length >= 3]).toEqual([scenario.id, true]);
      for (const step of scenario.steps) {
        expect([step.id, step.body.length >= 60]).toEqual([step.id, true]);
        expect([step.id, step.title.length <= 60]).toEqual([step.id, true]);
      }
    }
  });
});
