import { describe, it, expect } from 'vitest';
import { ValidationError } from '../../errors';
import { assertClonableRepo } from '../_clonable-repo';

describe('assertClonableRepo', () => {
  it('accepts a repository on a default host', () => {
    expect(() => assertClonableRepo('https://github.com/Appsilon/mediforce')).not.toThrow();
  });

  it('refuses a local path, which would read the server\'s own disk', () => {
    expect(() => assertClonableRepo('/etc')).toThrow(ValidationError);
    expect(() => assertClonableRepo('./repo')).toThrow(/local filesystem path/);
  });

  it('refuses a host the deployment does not clone from', () => {
    expect(() => assertClonableRepo('https://evil.example.com/org/repo')).toThrow(/not on a host/);
  });
});
