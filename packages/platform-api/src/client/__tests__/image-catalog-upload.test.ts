import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mediforce } from '../index';

describe('Mediforce imageCatalog.upload', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the archive as a file and the rest of the contract as JSON', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ imageTag: 'alpha/agent:v1', entryId: 'agent-1234abcd' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: 'http://localhost' });
    const result = await mediforce.imageCatalog.upload({
      namespace: 'alpha',
      reference: 'alpha/agent',
      tag: 'v1',
      dockerfile: 'container/Dockerfile',
      intent: 'Runs the ADaM checks we have no repo for',
      context: new Uint8Array([1, 2, 3]),
    });

    expect(result).toEqual({ imageTag: 'alpha/agent:v1', entryId: 'agent-1234abcd' });
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost/api/image-catalog/upload?namespace=alpha');
    expect(init?.method).toBe('POST');

    const form = init?.body as FormData;
    expect(JSON.parse(String(form.get('input')))).toEqual({
      reference: 'alpha/agent',
      tag: 'v1',
      dockerfile: 'container/Dockerfile',
      intent: 'Runs the ADaM checks we have no repo for',
    });
    const archive = form.get('context') as File;
    expect([...new Uint8Array(await archive.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('refuses a reference outside the namespace before sending anything', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: 'http://localhost' });
    await expect(
      mediforce.imageCatalog.upload({
        namespace: 'alpha',
        reference: 'postgres',
        dockerfile: '',
        context: new Uint8Array([1]),
      }),
    ).rejects.toThrow('alpha/');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
