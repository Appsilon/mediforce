import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolCatalogEntry } from '@mediforce/platform-core';

const mockApiFetch = vi.fn();
vi.mock('../api-fetch', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import {
  listCatalogEntries,
  getCatalogEntry,
  createCatalogEntry,
  updateCatalogEntry,
  deleteCatalogEntry,
} from '../mcp-admin-client';

function jsonResponse(body: unknown, { status = 200, ok = status < 400 } = {}): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

const entry: ToolCatalogEntry = {
  id: 'github',
  command: 'npx',
  args: ['-y', '@github/mcp-server'],
  env: { GITHUB_TOKEN: '{{SECRET:github}}' },
};

describe('mcp-admin-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listCatalogEntries', () => {
    it('GETs /api/admin/tool-catalog with namespace query and returns entries', async () => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse({ entries: [entry] }));

      const result = await listCatalogEntries('acme');

      expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/tool-catalog?namespace=acme');
      expect(result).toEqual([entry]);
    });

    it('throws with server error message on failure', async () => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, { status: 403 }));

      await expect(listCatalogEntries('acme')).rejects.toThrow('forbidden');
    });
  });

  describe('getCatalogEntry', () => {
    it('GETs /api/admin/tool-catalog/:id and returns entry', async () => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse({ entry }));

      const result = await getCatalogEntry('acme', 'github');

      expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/tool-catalog/github?namespace=acme');
      expect(result).toEqual(entry);
    });

    it('returns null on 404', async () => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse({ error: 'Not found' }, { status: 404 }));

      const result = await getCatalogEntry('acme', 'github');

      expect(result).toBeNull();
    });

    it('URL-encodes the id', async () => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse({ entry }));

      await getCatalogEntry('acme', 'has spaces');

      expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/tool-catalog/has%20spaces?namespace=acme');
    });
  });

  describe('createCatalogEntry', () => {
    it('POSTs the payload and returns created entry', async () => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse({ entry }, { status: 201 }));

      const payload = {
        id: 'github',
        command: 'npx',
        args: ['-y', '@github/mcp-server'],
        env: { GITHUB_TOKEN: '{{SECRET:github}}' },
      };
      const result = await createCatalogEntry('acme', payload);

      expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/tool-catalog?namespace=acme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(result).toEqual(entry);
    });

    it('throws on 409 conflict with error message', async () => {
      mockApiFetch.mockResolvedValueOnce(
        jsonResponse({ error: 'Catalog entry "github" already exists in namespace "acme".' }, { status: 409 }),
      );

      await expect(
        createCatalogEntry('acme', { command: 'npx' }),
      ).rejects.toThrow(/already exists/);
    });
  });

  describe('updateCatalogEntry', () => {
    it('PATCHes only the provided fields', async () => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse({ entry: { ...entry, description: 'GitHub MCP' } }));

      const result = await updateCatalogEntry('acme', 'github', { description: 'GitHub MCP' });

      expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/tool-catalog/github?namespace=acme', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'GitHub MCP' }),
      });
      expect(result.description).toBe('GitHub MCP');
    });
  });

  describe('deleteCatalogEntry', () => {
    it('DELETEs and returns void on success', async () => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

      await expect(deleteCatalogEntry('acme', 'github')).resolves.toBeUndefined();

      expect(mockApiFetch).toHaveBeenCalledWith('/api/admin/tool-catalog/github?namespace=acme', {
        method: 'DELETE',
      });
    });

    it('throws on non-ok response', async () => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse({ error: 'Not found' }, { status: 404 }));

      await expect(deleteCatalogEntry('acme', 'github')).rejects.toThrow('Not found');
    });
  });
});
