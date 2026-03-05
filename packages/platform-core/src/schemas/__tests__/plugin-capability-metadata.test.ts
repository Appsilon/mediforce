import { describe, it, expect } from 'vitest';
import {
  PluginCapabilityMetadataSchema,
  PluginRoleSchema,
} from '../plugin-capability-metadata.js';

const validMetadata = {
  name: 'Vendor Compliance Analyzer',
  description: 'Analyzes individual vendor compliance data',
  inputDescription: 'Vendor performance records',
  outputDescription: 'Compliance assessment with confidence score',
  roles: ['executor'] as const,
};

describe('PluginRoleSchema', () => {
  it('[DATA] accepts executor role', () => {
    expect(PluginRoleSchema.parse('executor')).toBe('executor');
  });

  it('[DATA] accepts reviewer role', () => {
    expect(PluginRoleSchema.parse('reviewer')).toBe('reviewer');
  });

  it('[ERROR] rejects invalid role', () => {
    expect(() => PluginRoleSchema.parse('admin')).toThrow();
  });
});

describe('PluginCapabilityMetadataSchema', () => {
  it('[DATA] parses valid metadata with all fields', () => {
    const result = PluginCapabilityMetadataSchema.parse(validMetadata);
    expect(result).toEqual(validMetadata);
  });

  it('[DATA] parses metadata with multiple roles', () => {
    const result = PluginCapabilityMetadataSchema.parse({
      ...validMetadata,
      roles: ['executor', 'reviewer'],
    });
    expect(result.roles).toEqual(['executor', 'reviewer']);
  });

  it('[ERROR] throws on missing roles field', () => {
    const { roles: _roles, ...withoutRoles } = validMetadata;
    expect(() => PluginCapabilityMetadataSchema.parse(withoutRoles)).toThrow();
  });

  it('[ERROR] throws on empty roles array', () => {
    expect(() =>
      PluginCapabilityMetadataSchema.parse({ ...validMetadata, roles: [] }),
    ).toThrow();
  });

  it('[ERROR] throws on invalid role in roles array', () => {
    expect(() =>
      PluginCapabilityMetadataSchema.parse({ ...validMetadata, roles: ['admin'] }),
    ).toThrow();
  });

  it('[ERROR] throws on missing name', () => {
    const { name: _name, ...withoutName } = validMetadata;
    expect(() => PluginCapabilityMetadataSchema.parse(withoutName)).toThrow();
  });

  it('[ERROR] throws on missing description', () => {
    const { description: _desc, ...withoutDesc } = validMetadata;
    expect(() => PluginCapabilityMetadataSchema.parse(withoutDesc)).toThrow();
  });

  it('[ERROR] throws on missing inputDescription', () => {
    const { inputDescription: _input, ...withoutInput } = validMetadata;
    expect(() => PluginCapabilityMetadataSchema.parse(withoutInput)).toThrow();
  });

  it('[ERROR] throws on missing outputDescription', () => {
    const { outputDescription: _output, ...withoutOutput } = validMetadata;
    expect(() => PluginCapabilityMetadataSchema.parse(withoutOutput)).toThrow();
  });
});
