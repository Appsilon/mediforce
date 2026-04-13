/**
 * Seed data for the Tool Catalog.
 * In production, this will come from Firestore (toolDefinitions collection).
 * For now, hardcoded entries show what the catalog UI looks like.
 */

export interface CatalogTool {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  description: string;
  allowedTools?: string[];
  category: string;
}

export const TOOL_CATALOG: CatalogTool[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'],
    description: 'Read and write files in a scoped directory. Useful for document processing pipelines.',
    category: 'Data Access',
  },
  {
    id: 'fetch',
    name: 'Fetch',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    description: 'Fetch URLs and extract content. Useful for pulling data from APIs, registries, and web pages.',
    category: 'Data Access',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: { DATABASE_URL: '{{DATABASE_URL}}' },
    description: 'Execute read-only SQL queries against a PostgreSQL database.',
    allowedTools: ['query'],
    category: 'Data Access',
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '/data/study.db'],
    description: 'Query a local SQLite database. Lightweight alternative to PostgreSQL for file-based datasets.',
    allowedTools: ['read_query'],
    category: 'Data Access',
  },
  {
    id: 'cdisc-library',
    name: 'CDISC Library',
    command: 'node',
    args: ['/opt/mcp-servers/cdisc-library/index.js'],
    env: { CDISC_API_KEY: '{{CDISC_API_KEY}}' },
    description: 'Look up SDTM/ADaM variable metadata, controlled terminology, and CDISC standards.',
    category: 'Clinical Data',
  },
];

export function getToolById(id: string): CatalogTool | undefined {
  return TOOL_CATALOG.find((t) => t.id === id);
}
