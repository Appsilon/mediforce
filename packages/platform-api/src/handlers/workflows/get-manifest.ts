import type { GetManifestInput, GetManifestOutput } from '../../contract/workflows';
import { GetManifestOutputSchema } from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { ValidationError, HandlerError } from '../../errors';
import { buildRawUrl } from './_github';

export async function getManifest(
  input: GetManifestInput,
  _scope: CallerScope,
): Promise<GetManifestOutput> {
  const ref = input.ref ?? 'main';
  const rawUrl = buildRawUrl(input.repo, ref, 'index.json');

  let json: unknown;
  try {
    const res = await fetch(rawUrl);
    if (!res.ok) {
      throw new ValidationError(
        `Failed to fetch manifest: ${res.status} ${res.statusText} (${rawUrl})`,
      );
    }
    json = (await res.json()) as unknown;
  } catch (err) {
    if (err instanceof HandlerError) throw err;
    throw new ValidationError(`Failed to fetch manifest: ${String(err)}`);
  }

  const parsed = GetManifestOutputSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError(
      `Invalid manifest format: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
    );
  }
  return parsed.data;
}
