import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMcpBinding } from '@mediforce/platform-core';

const mockApiFetch = vi.fn();
vi.mock('../api-fetch', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import {
  listAgentBindings,
  putAgentBinding,
  deleteAgentBinding,
} from '../agent-mcp-client';

function jsonResponse(body: unknown, { status = 200, ok = status < 400 } = {}): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

const stdioBinding: AgentMcpBinding = {
  type: 'stdio',
  catalogId: 'github',
};
const httpBinding: AgentMcpBinding = {
  type: 'http',
  url: 'https://mcp.example.com/sse',
  auth: { type: 'headers', headers: { Authorization: 'Bearer {{SECRET:token}}' } },
};

describe('agent-mcp-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listAgentBindings', () => {
    it('GETs bindings by agent id', async () => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse({ mcpServers: { github: stdioBinding } }));

      const result = await listAgentBindings('tealflow-cowork-chat');

      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/agent-definitions/tealflow-cowork-chat/mcp-servers',
      );
      expect(result).toEqual({ github: stdioBinding });
    });

    it('URL-encodes the agent id', async () => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse({ mcpServers: {} }));

      await listAgentBindings('has spaces/id');

      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/agent-definitions/has%20spaces%2Fid/mcp-servers',
      );
    });

    it('throws on server error', async () => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse({ error: 'Not found' }, { status: 404 }));

      await expect(listAgentBindings('missing')).rejects.toThrow('Not found');
    });
  });

  describe('putAgentBinding', () => {
    it('PUTs stdio binding and returns updated map', async () => {
      mockApiFetch.mockResolvedValueOnce(
        jsonResponse({ mcpServers: { github: stdioBinding } }),
      );

      const result = await putAgentBinding('agent-1', 'github', stdioBinding);

      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/agent-definitions/agent-1/mcp-servers/github',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(stdioBinding),
        },
      );
      expect(result).toEqual({ github: stdioBinding });
    });

    it('PUTs http binding preserving auth headers', async () => {
      mockApiFetch.mockResolvedValueOnce(
        jsonResponse({ mcpServers: { remote: httpBinding } }),
      );

      const result = await putAgentBinding('agent-1', 'remote', httpBinding);

      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/agent-definitions/agent-1/mcp-servers/remote',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(httpBinding),
        },
      );
      expect(result.remote).toEqual(httpBinding);
    });

    it('throws with validation error message on 400', async () => {
      mockApiFetch.mockResolvedValueOnce(
        jsonResponse({ error: 'Validation failed', issues: [] }, { status: 400 }),
      );

      await expect(
        putAgentBinding('agent-1', 'bad', stdioBinding),
      ).rejects.toThrow('Validation failed');
    });
  });

  describe('deleteAgentBinding', () => {
    it('DELETEs and returns remaining bindings', async () => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse({ mcpServers: {} }));

      const result = await deleteAgentBinding('agent-1', 'github');

      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/agent-definitions/agent-1/mcp-servers/github',
        { method: 'DELETE' },
      );
      expect(result).toEqual({});
    });
  });
});
