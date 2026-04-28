import { describe, expect, it } from 'vitest';
import { getPath, interpolate } from '../interpolation.js';
import type { InterpolationSources } from '../types.js';

const sources: InterpolationSources = {
  triggerPayload: {
    body: { hello: 'world', items: [{ id: 1 }, { id: 2 }] },
    method: 'POST',
  },
  steps: {
    fetch: { body: { json: { token: 'abc' } } },
  },
  variables: { greeting: 'hi' },
  secrets: { OWM_KEY: 'secret-key-123', PUSHOVER_TOKEN: 'push-token-456' },
};

describe('getPath', () => {
  it('walks dot notation', () => {
    expect(getPath({ a: { b: 1 } }, 'a.b')).toBe(1);
  });

  it('walks array indices via dot', () => {
    expect(getPath({ a: [{ x: 1 }] }, 'a.0.x')).toBe(1);
  });

  it('walks bracket array indices', () => {
    expect(getPath({ a: [{ x: 7 }] }, 'a[0].x')).toBe(7);
  });

  it('returns undefined for missing keys', () => {
    expect(getPath({ a: 1 }, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined for null short-circuit', () => {
    expect(getPath({ a: null }, 'a.b')).toBeUndefined();
  });

  it('returns the source for empty path', () => {
    const obj = { a: 1 };
    expect(getPath(obj, '')).toBe(obj);
  });
});

describe('interpolate', () => {
  it('returns non-string templates untouched (with deep walk for objects)', () => {
    expect(interpolate(42, sources)).toBe(42);
    expect(interpolate(null, sources)).toBe(null);
  });

  it('returns string with no placeholders unchanged', () => {
    expect(interpolate('plain', sources)).toBe('plain');
  });

  it('resolves a sole placeholder to its raw value (preserves objects)', () => {
    const result = interpolate('${triggerPayload.body}', sources);
    expect(result).toEqual({ hello: 'world', items: [{ id: 1 }, { id: 2 }] });
  });

  it('concatenates multi-placeholder templates as strings', () => {
    expect(
      interpolate('${variables.greeting}, ${triggerPayload.body.hello}!', sources),
    ).toBe('hi, world!');
  });

  it('walks array index inside multi-placeholder', () => {
    expect(
      interpolate('first=${triggerPayload.body.items.0.id}', sources),
    ).toBe('first=1');
  });

  it('JSON-stringifies non-string values inside multi-placeholder', () => {
    expect(
      interpolate('payload=${triggerPayload.body}', sources),
    ).toBe('payload={"hello":"world","items":[{"id":1},{"id":2}]}');
  });

  it('renders missing placeholders as empty string in concat', () => {
    expect(interpolate('a=${triggerPayload.missing}', sources)).toBe('a=');
  });

  it('walks deep into objects and interpolates each leaf', () => {
    const out = interpolate(
      { url: '${triggerPayload.method}', token: '${steps.fetch.body.json.token}' },
      sources,
    );
    expect(out).toEqual({ url: 'POST', token: 'abc' });
  });

  it('walks into arrays', () => {
    const out = interpolate(['${triggerPayload.body.hello}', 'static'], sources);
    expect(out).toEqual(['world', 'static']);
  });

  it('falls back across sources for bare identifiers', () => {
    const local: InterpolationSources = {
      triggerPayload: { x: 1 },
      steps: { y: 2 },
      variables: {},
      secrets: {},
    };
    expect(interpolate('${x}', local)).toBe(1);
    expect(interpolate('${y}', local)).toBe(2);
  });

  it('resolves ${secrets.NAME} to the secret value', () => {
    expect(interpolate('${secrets.OWM_KEY}', sources)).toBe('secret-key-123');
  });

  it('embeds secrets in multi-placeholder strings', () => {
    expect(
      interpolate('Bearer ${secrets.PUSHOVER_TOKEN}', sources),
    ).toBe('Bearer push-token-456');
  });

  it('renders unknown secret as empty string in concat', () => {
    expect(interpolate('key=${secrets.NOT_THERE}', sources)).toBe('key=');
  });

  it('does NOT resolve secrets via bare-identifier fallback', () => {
    // `${OWM_KEY}` without the `secrets.` prefix must return undefined —
    // explicit access prevents accidental secret leaks via copy-paste.
    expect(interpolate('${OWM_KEY}', sources)).toBeUndefined();
  });

  it('resolves bare ${secrets} root to undefined', () => {
    // No useful semantics for the whole bag; force callers to name a key.
    expect(interpolate('${secrets}', sources)).toBeUndefined();
  });
});
