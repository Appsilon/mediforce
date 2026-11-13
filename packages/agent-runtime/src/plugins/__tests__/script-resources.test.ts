import { describe, it, expect } from 'vitest';
import { resolveScriptResources } from '../script-resources';

describe('resolveScriptResources', () => {
  it('[DATA] keeps the platform default (8g, 2 CPUs) when the step asks for nothing', () => {
    expect(resolveScriptResources(undefined, {})).toEqual({ memory: '8g', cpus: 2, clamped: [] });
  });

  it('[DATA] grants a request within the deployment caps', () => {
    const env = { SCRIPT_MAX_MEMORY: '32g', SCRIPT_MAX_CPUS: '8' };
    expect(resolveScriptResources({ memory: '16g', cpus: 4 }, env)).toEqual({ memory: '16g', cpus: 4, clamped: [] });
  });

  it('[DATA] grants a request below the default', () => {
    expect(resolveScriptResources({ memory: '512m', cpus: 0.5 }, {})).toEqual({ memory: '512m', cpus: 0.5, clamped: [] });
  });

  it('[DATA] fills the unset field with the default', () => {
    const env = { SCRIPT_MAX_MEMORY: '32g' };
    expect(resolveScriptResources({ memory: '16g' }, env)).toEqual({ memory: '16g', cpus: 2, clamped: [] });
  });

  it('[DATA] clamps a request above the caps and says what it clamped', () => {
    const env = { SCRIPT_MAX_MEMORY: '12g', SCRIPT_MAX_CPUS: '3' };
    const resolved = resolveScriptResources({ memory: '16g', cpus: 4 }, env);
    expect(resolved.memory).toBe('12g');
    expect(resolved.cpus).toBe(3);
    expect(resolved.clamped).toEqual(['memory 16g > SCRIPT_MAX_MEMORY 12g', 'cpus 4 > SCRIPT_MAX_CPUS 3']);
  });

  it('[DATA] caps at the defaults on a deployment that sets no caps — unchanged behaviour', () => {
    const resolved = resolveScriptResources({ memory: '16g', cpus: 4 }, {});
    expect(resolved.memory).toBe('8g');
    expect(resolved.cpus).toBe(2);
    expect(resolved.clamped).toHaveLength(2);
  });

  it('[DATA] compares memory across units', () => {
    const env = { SCRIPT_MAX_MEMORY: '2048m' };
    expect(resolveScriptResources({ memory: '2g' }, env).memory).toBe('2g');
    expect(resolveScriptResources({ memory: '3g' }, env).memory).toBe('2048m');
  });

  it('[DATA] lowers the default without reporting a clamp when the step asked for nothing', () => {
    const resolved = resolveScriptResources(undefined, { SCRIPT_MAX_MEMORY: '4g', SCRIPT_MAX_CPUS: '1' });
    expect(resolved).toEqual({ memory: '4g', cpus: 1, clamped: [] });
  });

  it('[DATA] reads a cap with an upper-case unit', () => {
    expect(resolveScriptResources({ memory: '16g' }, { SCRIPT_MAX_MEMORY: '16G' }).memory).toBe('16g');
  });

  it('[DATA] treats an empty cap (compose forwards unset vars as "") as unset', () => {
    expect(resolveScriptResources(undefined, { SCRIPT_MAX_MEMORY: '', SCRIPT_MAX_CPUS: '' })).toEqual({ memory: '8g', cpus: 2, clamped: [] });
  });

  it('[ERROR] ignores malformed caps and falls back to the defaults', () => {
    const env = { SCRIPT_MAX_MEMORY: 'lots', SCRIPT_MAX_CPUS: '-1' };
    const resolved = resolveScriptResources({ memory: '16g', cpus: 4 }, env);
    expect(resolved.memory).toBe('8g');
    expect(resolved.cpus).toBe(2);
  });
});
