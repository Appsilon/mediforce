import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { defineCommand } from '../define-command';
import { printJson, printKv } from '../output';

/** Extensions the workspace logo schema accepts, mapped to their data-URL media type. */
const LOGO_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/**
 * Resolve `--logo` to what the API stores: a base64 `data:` URL. A value that is
 * already a data URL (or `''` to clear) passes through; anything else is read
 * from disk and encoded.
 *
 * Unlike the settings-page upload, there is no downscaling step here — that runs
 * on a browser canvas. A large source image is therefore rejected by the
 * `WORKSPACE_LOGO_MAX_CHARS` cap rather than silently resized, so pre-size the
 * file before uploading it through the CLI.
 */
async function resolveLogo(value: string): Promise<string> {
  if (value === '' || value.startsWith('data:')) return value;

  const mediaType = LOGO_MEDIA_TYPES[extname(value).toLowerCase()];
  if (mediaType === undefined) {
    throw new Error(
      `Unsupported logo file type "${extname(value)}". Expected one of: ${Object.keys(LOGO_MEDIA_TYPES).join(', ')}.`,
    );
  }

  const bytes = await readFile(value);
  return `data:${mediaType};base64,${bytes.toString('base64')}`;
}

export const namespaceUpdateCommand = defineCommand({
  name: 'mediforce namespace update',
  description: 'Edit workspace metadata (display name, bio, icon, logo, brand colors).',
  args: {
    handle: { type: 'string', required: true, description: 'Workspace handle' },
    'display-name': { type: 'string', description: 'New display name' },
    bio: { type: 'string', description: 'New bio (pass empty string to clear)' },
    icon: { type: 'string', description: 'New icon key (organizations only)' },
    logo: {
      type: 'string',
      description:
        'Path to a logo image, or a data: URL (organizations only; empty string clears)',
    },
    'brand-primary-color': {
      type: 'string',
      description: 'Main brand color as #rrggbb (organizations only; empty string clears)',
    },
    'brand-accent-color': {
      type: 'string',
      description: 'Auxiliary brand color as #rrggbb (organizations only; empty string clears)',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const input: Parameters<typeof mediforce.namespaces.update>[0] = { handle: args.handle };
    if (args['display-name'] !== undefined) input.displayName = args['display-name'];
    if (args.icon !== undefined) input.icon = args.icon;
    if (args.bio !== undefined) input.bio = args.bio;
    if (args.logo !== undefined) input.logo = await resolveLogo(args.logo);
    if (args['brand-primary-color'] !== undefined) {
      input.brandPrimaryColor = args['brand-primary-color'];
    }
    if (args['brand-accent-color'] !== undefined) {
      input.brandAccentColor = args['brand-accent-color'];
    }

    const result = await mediforce.namespaces.update(input);

    if (jsonMode) {
      printJson(output, result);
      return 0;
    }

    output.stdout(`Updated namespace ${result.namespace.handle}`);
    printKv(output, [
      ['displayName', result.namespace.displayName],
      ['bio', result.namespace.bio ?? undefined],
      ['icon', result.namespace.icon ?? undefined],
      // The logo is a multi-KB data URL; report whether it is set, not its bytes.
      ['logo', result.namespace.logo === undefined || result.namespace.logo === '' ? undefined : '(set)'],
      ['brandPrimaryColor', result.namespace.brandPrimaryColor ?? undefined],
      ['brandAccentColor', result.namespace.brandAccentColor ?? undefined],
    ]);
    return 0;
  },
});
