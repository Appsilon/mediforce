import { z } from 'zod';

export const FileMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  type: z.string().min(1),
  storagePath: z.string().min(1),
  uploadedAt: z.string().datetime(),
});

export type FileMetadata = z.infer<typeof FileMetadataSchema>;
