import { describe, it, expect } from 'vitest';
import {
  UpdateNamespaceBodySchema,
  UpdateNamespaceInputSchema,
  UpdateNamespaceMemberRoleBodySchema,
  LeaveNamespaceInputSchema,
  DeleteNamespaceInputSchema,
  RemoveNamespaceMemberInputSchema,
} from '../namespaces';
import { ClearMustChangePasswordInputSchema, ClearMustChangePasswordOutputSchema } from '../users';

describe('UpdateNamespace schemas', () => {
  it('UpdateNamespaceBodySchema requires at least one field', () => {
    expect(UpdateNamespaceBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateNamespaceBodySchema.safeParse({ displayName: 'Acme' }).success).toBe(true);
    expect(UpdateNamespaceBodySchema.safeParse({ bio: '' }).success).toBe(true);
    expect(UpdateNamespaceBodySchema.safeParse({ icon: 'Briefcase' }).success).toBe(true);
  });

  it('UpdateNamespaceInputSchema rejects { handle } with no edits', () => {
    expect(UpdateNamespaceInputSchema.safeParse({ handle: 'acme' }).success).toBe(false);
  });

  it('UpdateNamespaceInputSchema accepts handle + one of the edit fields', () => {
    expect(UpdateNamespaceInputSchema.safeParse({ handle: 'acme', displayName: 'Acme' }).success).toBe(true);
  });

  it('UpdateNamespaceInputSchema rejects an empty displayName', () => {
    const parsed = UpdateNamespaceInputSchema.safeParse({ handle: 'acme', displayName: '' });
    expect(parsed.success).toBe(false);
  });

  it('UpdateNamespaceInputSchema accepts bio: "" to clear', () => {
    expect(UpdateNamespaceInputSchema.safeParse({ handle: 'acme', bio: '' }).success).toBe(true);
  });
});

describe('UpdateNamespaceMemberRoleBodySchema', () => {
  it('accepts admin / member only', () => {
    expect(UpdateNamespaceMemberRoleBodySchema.safeParse({ role: 'admin' }).success).toBe(true);
    expect(UpdateNamespaceMemberRoleBodySchema.safeParse({ role: 'member' }).success).toBe(true);
    expect(UpdateNamespaceMemberRoleBodySchema.safeParse({ role: 'owner' }).success).toBe(false);
  });
});

describe('ClearMustChangePassword schemas', () => {
  it('input accepts empty object (user caller) and optional uid (apiKey caller)', () => {
    expect(ClearMustChangePasswordInputSchema.safeParse({}).success).toBe(true);
    expect(ClearMustChangePasswordInputSchema.safeParse({ uid: 'uid-marek' }).success).toBe(true);
  });

  it('input rejects unknown keys (strict)', () => {
    expect(ClearMustChangePasswordInputSchema.safeParse({ extra: 'x' }).success).toBe(false);
  });

  it('output locks mustChangePassword to literal false', () => {
    expect(
      ClearMustChangePasswordOutputSchema.safeParse({
        user: { uid: 'uid-marek', mustChangePassword: false },
      }).success,
    ).toBe(true);
    expect(
      ClearMustChangePasswordOutputSchema.safeParse({
        user: { uid: 'uid-marek', mustChangePassword: true },
      }).success,
    ).toBe(false);
  });
});

describe('Path-param input schemas', () => {
  it('LeaveNamespace / DeleteNamespace / RemoveNamespaceMember require a valid handle', () => {
    expect(LeaveNamespaceInputSchema.safeParse({ handle: 'acme' }).success).toBe(true);
    expect(DeleteNamespaceInputSchema.safeParse({ handle: 'acme' }).success).toBe(true);
    expect(RemoveNamespaceMemberInputSchema.safeParse({ handle: 'acme', uid: 'uid-x' }).success).toBe(true);
    expect(RemoveNamespaceMemberInputSchema.safeParse({ handle: 'acme', uid: '' }).success).toBe(false);
  });
});
