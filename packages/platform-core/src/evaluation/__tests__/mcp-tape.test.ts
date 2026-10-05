import { describe, it, expect } from 'vitest';
import {
  describeMcpPolicy,
  describeMcpReport,
  mcpReplayMissEntry,
  mcpReplayMissesOf,
  mergeMcpTapes,
} from '../mcp-tape';

const READ_TOOL = { name: 'read_record', inputSchema: { type: 'object' } };

describe('mergeMcpTapes (ADR-0023 D6)', () => {
  it('keeps each distinct call, the newest recording of it winning, and the newest tool list', () => {
    const older = {
      tools: [READ_TOOL],
      calls: [
        { tool: 'read_record', arguments: { subject: '1001' }, result: { content: [{ type: 'text', text: 'old 1001' }] } },
        { tool: 'read_record', arguments: { subject: '1002' }, result: { content: [{ type: 'text', text: '1002' }] } },
      ],
    };
    const newer = {
      tools: [READ_TOOL, { name: 'list_visits', inputSchema: { type: 'object' } }],
      calls: [
        { tool: 'read_record', arguments: { subject: '1001' }, result: { content: [{ type: 'text', text: 'new 1001, first' }] } },
        { tool: 'read_record', arguments: { subject: '1001' }, result: { content: [{ type: 'text', text: 'new 1001, second' }] } },
      ],
    };

    const merged = mergeMcpTapes([older, newer]);

    expect(merged.tools).toEqual(newer.tools);
    expect(merged.calls.map((call) => call.result.content)).toEqual([
      [{ type: 'text', text: 'new 1001, first' }],
      [{ type: 'text', text: 'new 1001, second' }],
      [{ type: 'text', text: '1002' }],
    ]);
  });

  it('keeps the older tool list when a newer recording listed none', () => {
    expect(mergeMcpTapes([{ tools: [READ_TOOL], calls: [] }, { tools: [], calls: [] }]).tools).toEqual([READ_TOOL]);
  });
});

describe('replay misses in an Agent Trajectory', () => {
  it('round-trips a miss through its trajectory entry and ignores every other entry', () => {
    const miss = { server: 'edc', tool: 'read_record', arguments: { subject: '1001' } };
    const entries = [
      { ts: '2026-09-23T08:00:00.000Z', type: 'assistant', subtype: 'tool_call', tool: 'mcp__edc__read_record' },
      mcpReplayMissEntry(miss, '2026-09-23T08:00:01.000Z'),
    ];
    expect(mcpReplayMissesOf(entries)).toEqual([miss]);
  });
});

describe('describeMcpReport', () => {
  it('says no trial made a live MCP call when no server was live, and names what replay could not answer', () => {
    expect(describeMcpReport({
      live: [], replayed: ['edc'], denied: ['email'], recordedFirst: [],
      unrecordedCalls: [{ server: 'edc', tool: 'read_record', count: 2 }],
    })).toBe('MCP servers: edc replayed; email denied. No trial made a live MCP call. '
      + '2 replayed calls had no recording and got an error (edc/read_record ×2).');
  });

  it('does not claim no live call when a server was live', () => {
    expect(describeMcpReport({ live: ['meddra'], replayed: [], denied: [], recordedFirst: [], unrecordedCalls: [] })).toBe('MCP servers: meddra live.');
  });

  it('names the cases a replayed server ran live to record, and then claims no live call', () => {
    expect(describeMcpReport({
      live: [], replayed: ['edc', 'meddra'], denied: [], recordedFirst: [{ server: 'edc', cases: 2 }], unrecordedCalls: [],
    })).toBe('MCP servers: edc, meddra replayed. edc ran live for 2 cases with no recording yet, and recorded them.');
  });
});

describe('describeMcpPolicy', () => {
  it('states each server of a frozen policy by its mode, and nothing about the calls it made', () => {
    expect(describeMcpPolicy({ meddra: { mode: 'live', denyTools: ['update'] }, edc: { mode: 'replay' }, email: { mode: 'deny' } }))
      .toBe('MCP servers: meddra live; edc replayed; email denied.');
    expect(describeMcpPolicy({ edc: { mode: 'replay' } })).toBe('MCP servers: edc replayed.');
  });
});
