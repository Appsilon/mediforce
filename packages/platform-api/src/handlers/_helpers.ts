import { ApiError } from '../errors.js';

export async function loadOr404<T>(
  lookup: Promise<T | null>,
  notFoundMessage: string,
): Promise<T> {
  const entity = await lookup;
  if (entity === null) throw new ApiError('not_found', notFoundMessage);
  return entity;
}
