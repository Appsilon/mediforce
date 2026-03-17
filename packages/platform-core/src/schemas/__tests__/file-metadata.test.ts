import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { FileMetadataSchema } from '../file-metadata.js';

const validFileMetadata = {
  id: 'file-001',
  name: 'protocol.pdf',
  size: 102400,
  type: 'application/pdf',
  storagePath: 'uploads/inst-001/protocol.pdf',
  uploadedAt: '2026-01-15T10:00:00Z',
};

describe('FileMetadataSchema', () => {
  it('[DATA] should parse valid file metadata', () => {
    const result = FileMetadataSchema.safeParse(validFileMetadata);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('file-001');
      expect(result.data.name).toBe('protocol.pdf');
      expect(result.data.storagePath).toBe('uploads/inst-001/protocol.pdf');
    }
  });

  it('[DATA] should reject file metadata without id', () => {
    const { id: _, ...noId } = validFileMetadata;
    const result = FileMetadataSchema.safeParse(noId);
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject file metadata without storagePath', () => {
    const { storagePath: _, ...noPath } = validFileMetadata;
    const result = FileMetadataSchema.safeParse(noPath);
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject file metadata with negative size', () => {
    const result = FileMetadataSchema.safeParse({ ...validFileMetadata, size: -1 });
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject file metadata with empty name', () => {
    const result = FileMetadataSchema.safeParse({ ...validFileMetadata, name: '' });
    expect(result.success).toBe(false);
  });

  it('[DATA] should reject file metadata with invalid datetime', () => {
    const result = FileMetadataSchema.safeParse({ ...validFileMetadata, uploadedAt: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  it('[DATA] should parse array of file metadata', () => {
    const files = [
      validFileMetadata,
      { ...validFileMetadata, id: 'file-002', name: 'sap.pdf', storagePath: 'uploads/inst-001/sap.pdf' },
    ];
    const result = z.array(FileMetadataSchema).safeParse(files);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
    }
  });
});
