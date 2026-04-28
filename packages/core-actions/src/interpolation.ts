import type { InterpolationSources } from './types.js';

/**
 * L3 path access: dot-notation walk with array index support.
 *
 * Supported:
 *   getPath({a:{b:1}}, 'a.b')               === 1
 *   getPath({a:[{x:1}]}, 'a.0.x')           === 1
 *   getPath({a:[{x:1}]}, 'a[0].x')          === 1
 *   getPath({a:{b:null}}, 'a.b.c')          === undefined  (null short-circuits)
 *
 * Returns undefined for any missing/invalid path. No exceptions thrown so
 * callers can decide whether a missing key is fatal or render-as-empty.
 */
export function getPath(source: unknown, dotPath: string): unknown {
  if (dotPath.length === 0) return source;

  const segments: string[] = [];
  let buffer = '';
  for (const ch of dotPath) {
    if (ch === '.') {
      if (buffer.length > 0) {
        segments.push(buffer);
        buffer = '';
      }
      continue;
    }
    if (ch === '[') {
      if (buffer.length > 0) {
        segments.push(buffer);
        buffer = '';
      }
      continue;
    }
    if (ch === ']') {
      if (buffer.length > 0) {
        segments.push(buffer);
        buffer = '';
      }
      continue;
    }
    buffer += ch;
  }
  if (buffer.length > 0) segments.push(buffer);

  let current: unknown = source;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(segment);
      if (!Number.isInteger(idx)) return undefined;
      current = current[idx];
      continue;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

/** Pattern matches `${path}` — captures the dot-notation path inside the braces.
 *  Backslash escape is intentionally NOT supported (no callers need it
 *  and it keeps the parser trivial). */
const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;

/**
 * L3 string interpolation: `"prefix-${a.b}-${c[0]}"` → resolves each
 * placeholder against the merged sources and concatenates back to a string.
 *
 * Resolution order: `triggerPayload`, then `steps`, then `variables`. The
 * first source whose path resolves to a non-undefined value wins. Missing
 * placeholders render to an empty string — workflows that need strict
 * resolution should escalate to a script step (decision G3).
 *
 * Non-string values are JSON-stringified when concatenated into a wider
 * template, but a sole `${path}` returning a non-string is preserved as-is
 * (so `body: '${triggerPayload.body}'` returns the raw body object, not a
 * string). This matches n8n's "single expression returns the value" rule.
 */
export function interpolate(
  template: unknown,
  sources: InterpolationSources,
): unknown {
  if (typeof template !== 'string') return interpolateDeep(template, sources);
  return interpolateString(template, sources);
}

function interpolateString(
  template: string,
  sources: InterpolationSources,
): unknown {
  PLACEHOLDER_RE.lastIndex = 0;
  const matches = [...template.matchAll(PLACEHOLDER_RE)];
  if (matches.length === 0) return template;

  if (matches.length === 1) {
    const match = matches[0];
    const isOnlyPlaceholder =
      match.index === 0 && match[0].length === template.length;
    if (isOnlyPlaceholder) {
      return resolvePath(match[1], sources);
    }
  }

  return template.replace(PLACEHOLDER_RE, (_full, path: string) => {
    const value = resolvePath(path, sources);
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  });
}

function interpolateDeep(
  value: unknown,
  sources: InterpolationSources,
): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, sources));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = interpolate(v, sources);
    }
    return out;
  }
  return value;
}

function resolvePath(rawPath: string, sources: InterpolationSources): unknown {
  const path = rawPath.trim();
  const root = path.split(/[.[]/, 1)[0];
  const rest = path.slice(root.length).replace(/^\./, '');

  let resolved: unknown;
  if (root === 'triggerPayload') {
    resolved = rest.length === 0 ? sources.triggerPayload : getPath(sources.triggerPayload, rest);
  } else if (root === 'steps') {
    resolved = rest.length === 0 ? sources.steps : getPath(sources.steps, rest);
  } else if (root === 'variables') {
    resolved = rest.length === 0 ? sources.variables : getPath(sources.variables, rest);
  } else if (root === 'secrets') {
    // Secrets resolve only via the explicit `secrets.NAME` form — never via
    // the bare-identifier fallback below — to make leaks visible in code review.
    resolved = rest.length === 0 ? undefined : getPath(sources.secrets, rest);
  } else {
    // Bare identifiers fall through to triggerPayload for n8n-style ergonomics.
    // Deliberately NOT searching `secrets` here — secret access must be explicit.
    resolved = getPath(sources.triggerPayload, path)
      ?? getPath(sources.steps, path)
      ?? getPath(sources.variables, path);
  }
  return resolved;
}
