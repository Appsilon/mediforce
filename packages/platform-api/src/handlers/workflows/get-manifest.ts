import type { GetManifestInput, GetManifestOutput } from '../../contract/workflows';
import { GetManifestOutputSchema } from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { ValidationError } from '../../errors';
import { buildRawUrl, fetchFirstJson, resolveGitHubSource } from './_github';

/** `workflows-index.json` is the canonical browse manifest; `index.json` is the
 *  name repos published under before it and is still read when the canonical one
 *  is absent, so an existing repo stays browsable without being republished. */
const MANIFEST_FILENAMES = ['workflows-index.json', 'index.json'];

export async function getManifest(
  input: GetManifestInput,
  _scope: CallerScope,
): Promise<GetManifestOutput> {
  // Resolve through the same path as import so browsing lists the manifest the
  // import will actually read — a tree URL's directory is only known once its
  // ref boundary is resolved, which a bare raw-URL build cannot do.
  const source = await resolveGitHubSource(input.repo, input.ref);

  const json = await fetchFirstJson(
    MANIFEST_FILENAMES.map((file) =>
      buildRawUrl(source.repo, source.commit, file, source.pathPrefix),
    ),
    'manifest',
  );

  const parsed = GetManifestOutputSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError(
      `Invalid manifest format: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
    );
  }
  return parsed.data;
}
