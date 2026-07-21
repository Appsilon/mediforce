import { describe, it, expect } from 'vitest';
import { buildUserRolesSeed, type FirebaseUserExport } from '../seed-user-roles';

const FIXTURE: FirebaseUserExport[] = [
  {
    uid: 'u1',
    email: 'alice@x.com',
    displayName: 'Alice',
    photoURL: 'https://img/a',
    customClaims: { roles: ['reviewer', 'approver'], role: 'admin' },
  },
  { uid: 'u2', email: 'bob@x.com', displayName: null, customClaims: { roles: ['reviewer'] } },
  { uid: 'u3', email: 'carol@x.com', customClaims: { role: 'auditor' } },
  { uid: 'u4', email: 'dan@x.com', customClaims: null },
];

describe('buildUserRolesSeed', () => {
  it('emits one auth_users row per user with email, mapping displayName/photoURL', () => {
    const seed = buildUserRolesSeed([FIXTURE[0]!]);
    expect(seed.authUsers).toEqual([
      { id: 'u1', email: 'alice@x.com', name: 'Alice', image: 'https://img/a' },
    ]);
  });

  it('expands roles[] to one row each and ignores the role scalar when roles[] is present', () => {
    const seed = buildUserRolesSeed([FIXTURE[0]!]);
    expect(seed.userRoles).toEqual([
      { uid: 'u1', role: 'reviewer' },
      { uid: 'u1', role: 'approver' },
    ]);
  });

  it('falls back to the role scalar only when roles[] is absent', () => {
    const seed = buildUserRolesSeed([FIXTURE[2]!]);
    expect(seed.userRoles).toEqual([{ uid: 'u3', role: 'auditor' }]);
  });

  it('emits no roles for a user without claims but still seeds the auth_users row', () => {
    const seed = buildUserRolesSeed([FIXTURE[3]!]);
    expect(seed.userRoles).toEqual([]);
    expect(seed.authUsers).toEqual([{ id: 'u4', email: 'dan@x.com', name: null, image: null }]);
  });

  it('de-duplicates repeated roles within a user', () => {
    const seed = buildUserRolesSeed([
      { uid: 'u9', email: 'e@x.com', customClaims: { roles: ['reviewer', 'reviewer', ''] } },
    ]);
    expect(seed.userRoles).toEqual([{ uid: 'u9', role: 'reviewer' }]);
  });

  it('skips users without an email (auth_users.email is NOT NULL UNIQUE)', () => {
    const seed = buildUserRolesSeed([
      { uid: 'n1', email: null, customClaims: { roles: ['reviewer'] } },
      { uid: 'n2', email: '', customClaims: { roles: ['reviewer'] } },
    ]);
    expect(seed.authUsers).toEqual([]);
    expect(seed.userRoles).toEqual([]);
    expect(seed.skippedNoEmail).toEqual(['n1', 'n2']);
  });

  it('is idempotent — same input yields deep-equal output', () => {
    expect(buildUserRolesSeed(FIXTURE)).toEqual(buildUserRolesSeed(FIXTURE));
  });

  // Faithful port of the old Firebase `getUsersByRole` filter (ADR-0002 §5):
  // roles[] takes precedence over the role scalar, so the resulting role→uid
  // mapping must match what the Firebase directory resolved. The scalar
  // 'admin' on u1 is ignored because u1 has a roles[] array.
  it('produces the same role→uid mapping the Firebase directory resolved', () => {
    const seed = buildUserRolesSeed(FIXTURE);
    const uidsForRole = (role: string) =>
      seed.userRoles.filter((r) => r.role === role).map((r) => r.uid).sort();

    expect(uidsForRole('reviewer')).toEqual(['u1', 'u2']);
    expect(uidsForRole('approver')).toEqual(['u1']);
    expect(uidsForRole('auditor')).toEqual(['u3']);
    expect(uidsForRole('admin')).toEqual([]);
    expect(uidsForRole('nonexistent')).toEqual([]);
  });
});
