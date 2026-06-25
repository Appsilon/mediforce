import type { GetManifestInput, GetManifestOutput } from '../../contract/workflows';
import { GetManifestOutputSchema } from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { ValidationError } from '../../errors';
import { buildRawUrl, fetchJsonOrThrow } from './_github';

export async function getManifest(
  input: GetManifestInput,
  _scope: CallerScope,
): Promise<GetManifestOutput> {
  const ref = input.ref ?? 'main';
  const rawUrl = buildRawUrl(input.repo, ref, 'index.json');

  const json = await fetchJsonOrThrow(rawUrl, 'manifest');

  const parsed = GetManifestOutputSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError(
      `Invalid manifest format: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
    );
  }
  return parsed.data;
}
