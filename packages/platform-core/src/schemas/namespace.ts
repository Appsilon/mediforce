import { z } from 'zod';

export const NamespaceTypeSchema = z.enum(['personal', 'organization']);

/**
 * A workspace brand color: a 6-digit hex string (`#rrggbb`), or `""` to signal
 * "cleared, fall back to the platform default" — the same two-state convention
 * `bio` uses. The UI converts the hex to an HSL triple at render time to
 * override the `--primary` / `--accent` design tokens.
 */
export const BrandColorSchema = z
  .string()
  .regex(/^(#[0-9a-fA-F]{6})?$/, 'must be a hex color like #0d9488');

/**
 * A workspace logo, stored inline as a base64 `data:` image URL (or `""` to
 * clear). Kept on the workspace record rather than the blob store so it travels
 * with the already-authenticated `namespaces.get` / `users.me` payloads and
 * renders via a plain `<img src>` — no separate authenticated fetch. The
 * ~256 KiB char cap keeps that payload small; logos should be optimised
 * (SVG/PNG) assets, not photos.
 */
export const WORKSPACE_LOGO_MAX_CHARS = 512 * 1024;
export const WorkspaceLogoSchema = z
  .string()
  .max(WORKSPACE_LOGO_MAX_CHARS, 'logo image is too large')
  .refine(
    (value) => value === '' || /^data:image\/(png|jpeg|jpg|svg\+xml|webp|gif);base64,/.test(value),
    'logo must be a base64 image data URL',
  );

export const NamespaceSchema = z.object({
  handle: z.string().min(1),
  type: NamespaceTypeSchema,
  displayName: z.string().min(1),
  avatarUrl: z.string().url().optional(),
  icon: z.string().optional(),
  logo: WorkspaceLogoSchema.optional(),
  brandPrimaryColor: BrandColorSchema.optional(),
  brandAccentColor: BrandColorSchema.optional(),
  linkedUserId: z.string().optional(),
  bio: z.string().optional(),
  createdAt: z.string().datetime(),
});

export const NamespaceMemberSchema = z.object({
  uid: z.string().min(1),
  role: z.enum(['owner', 'admin', 'member']),
  displayName: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  joinedAt: z.string().datetime(),
});

export const NamespaceMembershipSchema = z.object({
  handle: z.string().min(1),
  role: z.enum(['owner', 'admin', 'member']),
});

export type NamespaceType = z.infer<typeof NamespaceTypeSchema>;
export type Namespace = z.infer<typeof NamespaceSchema>;
export type NamespaceMember = z.infer<typeof NamespaceMemberSchema>;
export type NamespaceMembership = z.infer<typeof NamespaceMembershipSchema>;
