/**
 * The execution log has to answer two questions: what is the run doing right
 * now, and what did one step do. The default view is the whole run, step by
 * step; picking a step narrows to it.
 *
 * Polling has to stop on its own. A run whose steps have all stopped will never
 * produce another line, and during a rolling deploy an older worker can finish a
 * run without ever writing the `result` entry the viewer keys off — without a
 * ceiling that tab polls every 3 seconds forever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiFetchMock = vi.fn();
vi.mock('@/lib/api-fetch', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const { AgentLogSections, AgentLogViewer, shouldStopPolling, buildGroups, latestTodos, callSummary, resultSummary, entryMatches } = await import('../agent-log-viewer');
type AgentLogSection = import('../agent-log-viewer').AgentLogSection;

function section(stepId: string, texts: string[], overrides: Partial<AgentLogSection> = {}): AgentLogSection {
  return {
    stepId,
    file: `${stepId}.jsonl`,
    executor: 'agent',
    entries: texts.map((text) => ({ ts: '2026-01-01T00:00:00.000Z', type: 'assistant', subtype: 'text', text })),
    rawContent: null,
    error: null,
    ...overrides,
  };
}

const finished = (stepId: string): AgentLogSection => ({
  ...section(stepId, ['working']),
  entries: [
    { ts: '2026-01-01T00:00:00.000Z', type: 'assistant', subtype: 'text', text: 'working' },
    { ts: '2026-01-01T00:00:01.000Z', type: 'result', subtype: 'success' },
  ],
});

describe('AgentLogSections', () => {
  it('shows every step at once, under its own heading', () => {
    render(
      <AgentLogSections
        sections={[section('extract', ['reading the file']), section('validate', ['checking ranges'])]}
        runningStepIds={new Set()}
      />,
    );

    expect(screen.getByText('extract')).toBeInTheDocument();
    expect(screen.getByText('validate')).toBeInTheDocument();
    expect(screen.getByText('reading the file')).toBeInTheDocument();
    expect(screen.getByText('checking ranges')).toBeInTheDocument();
  });

  it('opens the running step and leaves a finished one as a heading', () => {
    render(
      <AgentLogSections
        sections={[section('extract', ['done work']), section('validate', ['live work'])]}
        runningStepIds={new Set(['validate'])}
      />,
    );

    const open = [...document.querySelectorAll('details')].map((el) => el.open);
    expect(open).toEqual([false, true]);
  });

  it('keeps the steps in the order they were given, not the order they finished', () => {
    const { container } = render(
      <AgentLogSections
        sections={[section('extract', ['a']), section('validate', ['b']), section('report', ['c'])]}
        runningStepIds={new Set()}
      />,
    );

    const headings = [...container.querySelectorAll('[data-step-heading]')].map((el) => el.textContent);
    expect(headings).toEqual(['extract', 'validate', 'report']);
  });
});

/**
 * The step-execution rows a run has are not a reliable "still working" signal —
 * a step between executions, or one whose row has not been written yet, leaves
 * the set empty while the agent is mid-tool. Keying the ceiling off it froze
 * the log a minute into a live step, and only a reload brought it back. The
 * run's own status is the signal that always exists.
 */
/**
 * `{"type":"result","subtype":"tool-calls"}` is the model pausing to use a tool
 * and coming back — a step emits one every turn, the first within seconds of
 * starting. Counting it as the step finishing stopped the poll almost
 * immediately, which is why the log only ever moved on a reload.
 */
describe('shouldStopPolling and turn boundaries', () => {
  const turning = (stepId: string): AgentLogSection => ({
    ...section(stepId, ['working']),
    entries: [
      { ts: '2026-01-01T00:00:00.000Z', type: 'assistant', subtype: 'text', text: 'working' },
      { ts: '2026-01-01T00:00:01.000Z', type: 'result', subtype: 'tool-calls' },
    ],
  });

  it('does not treat a turn boundary as the step finishing', () => {
    expect(shouldStopPolling({
      sections: [turning('extract')],
      runActive: false,
      idlePolls: 0,
    })).toBe(false);
  });

  it('still stops on a real completion', () => {
    expect(shouldStopPolling({
      sections: [finished('extract')],
      runActive: true,
      idlePolls: 0,
    })).toBe(true);
  });
});

describe('shouldStopPolling while the run is still going', () => {
  it('keeps polling through a quiet stretch with no step marked running', () => {
    expect(shouldStopPolling({
      sections: [section('extract', ['working'])],
      runActive: true,
      idlePolls: 99,
    })).toBe(false);
  });

  it('stops once the run itself is over and nothing new arrives', () => {
    const args = { sections: [section('extract', ['working'])], runActive: false, anyStepRunning: false };
    expect(shouldStopPolling({ ...args, idlePolls: 1 })).toBe(false);
    expect(shouldStopPolling({ ...args, idlePolls: 3 })).toBe(true);
  });

  it('stops on a finished run even while it was still going', () => {
    expect(shouldStopPolling({
      sections: [finished('extract')],
      runActive: true,
      idlePolls: 0,
    })).toBe(true);
  });
});

describe('shouldStopPolling', () => {
  it('stops once every step has reported a result', () => {
    expect(shouldStopPolling({
      sections: [finished('extract'), finished('validate')],
      runActive: false,
      idlePolls: 0,
    })).toBe(true);
  });

  it('keeps polling while the run is going, however quiet it is', () => {
    expect(shouldStopPolling({
      sections: [section('extract', ['working'])],
      runActive: true,
      idlePolls: 99,
    })).toBe(false);
  });

  it('gives up on a finished run that never reported a result', () => {
    const args = { sections: [section('extract', ['working'])], runActive: false, anyStepRunning: false };

    expect(shouldStopPolling({ ...args, idlePolls: 1 })).toBe(false);
    expect(shouldStopPolling({ ...args, idlePolls: 3 })).toBe(true);
  });

  it('does not stop on an empty log, which is a run that has not started writing yet', () => {
    expect(shouldStopPolling({ sections: [], runActive: true, anyStepRunning: true, idlePolls: 0 })).toBe(false);
  });
});

/**
 * The parent rebuilds `logFiles` and `runningStepIds` on its own 1.5s poll, and
 * an omitted `runningStepIds` is a fresh Set on every render. Either one in an
 * effect's dependencies makes the fetch callback outlive its own interval and
 * the viewer hammers /api/step-logs as fast as React will re-render it.
 */
describe('AgentLogViewer fetch cadence', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ content: '' }),
      text: async () => '',
      status: 200,
      statusText: 'OK',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches once for a re-rendering parent that passes no runningStepIds', async () => {
    const logFiles = [{ stepId: 'extract', file: 'extract.jsonl', executor: 'agent' }];
    const { rerender } = render(<AgentLogViewer logFiles={logFiles} />);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());

    for (let i = 0; i < 5; i += 1) {
      rerender(<AgentLogViewer logFiles={[...logFiles]} />);
    }
    await Promise.resolve();

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refetch when the parent rebuilds runningStepIds with the same contents', async () => {
    const logFiles = [{ stepId: 'extract', file: 'extract.jsonl', executor: 'agent' }];
    const { rerender } = render(
      <AgentLogViewer logFiles={logFiles} runningStepIds={new Set(['extract'])} />,
    );
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());

    for (let i = 0; i < 5; i += 1) {
      rerender(<AgentLogViewer logFiles={[...logFiles]} runningStepIds={new Set(['extract'])} />);
    }
    await Promise.resolve();

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });
});

const call = (tool: string, input: Record<string, unknown>, ts = '2026-01-01T00:00:00.000Z') =>
  ({ ts, type: 'assistant', subtype: 'tool_call', tool, input });
const toolResult = (content: string, ts = '2026-01-01T00:00:00.000Z') =>
  ({ ts, type: 'user', subtype: 'tool_result', content });
const todos = (...statuses: string[]) =>
  statuses.map((status, index) => ({ content: `task ${index}`, status }));

/**
 * The agent resends the whole todo list every time it ticks one item, so the
 * log carries N copies of the same seven lines. They are revisions of one piece
 * of state, not N events, and the reader wants the current state.
 */
describe('latestTodos', () => {
  it('returns the most recent list, not every revision', () => {
    const entries = [
      call('TodoWrite', { todos: todos('pending', 'pending') }),
      call('TodoWrite', { todos: todos('completed', 'in_progress') }),
    ];
    expect(latestTodos(entries)).toEqual(todos('completed', 'in_progress'));
  });

  it('is null when the agent never wrote a task list', () => {
    expect(latestTodos([call('Bash', { command: 'ls' })])).toBeNull();
  });
});

describe('buildGroups', () => {
  it('pairs a tool call with the result that follows it', () => {
    const groups = buildGroups([
      call('Bash', { command: 'ls' }),
      toolResult('a.txt'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'calls',
      calls: [{ call: { tool: 'Bash' }, result: { content: 'a.txt' } }],
    });
  });

  it('pairs parallel calls with their results in order', () => {
    const groups = buildGroups([
      call('Read', { file_path: '/a' }),
      call('Read', { file_path: '/b' }),
      toolResult('contents of a'),
      toolResult('contents of b'),
    ]);
    expect(groups).toHaveLength(1);
    expect((groups[0] as { calls: { result: { content: string } }[] }).calls.map((c) => c.result.content))
      .toEqual(['contents of a', 'contents of b']);
  });

  it('does not call sequential tool use parallel', () => {
    // call → result → call → result is two turns. Only calls issued together,
    // with no result between them, ran in parallel.
    const groups = buildGroups([
      call('Read', { file_path: '/a' }),
      toolResult('contents of a'),
      call('Bash', { command: 'ls' }),
      toolResult('a.txt'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => (group as { calls: unknown[] }).calls.length === 1)).toBe(true);
  });

  it('drops the task list and its echoed result — the checklist shows that state', () => {
    const groups = buildGroups([
      call('TodoWrite', { todos: todos('pending') }),
      toolResult('[{"content":"task 0","status":"pending"}]'),
      call('Bash', { command: 'ls' }),
      toolResult('a.txt'),
    ]);
    expect(groups).toHaveLength(1);
    expect((groups[0] as { calls: { call: { tool: string } }[] }).calls.map((c) => c.call.tool)).toEqual(['Bash']);
  });

  it('drops a turn boundary, which is not the step finishing', () => {
    const groups = buildGroups([
      { ts: '2026-01-01T00:00:00.000Z', type: 'result', subtype: 'tool-calls' },
      { ts: '2026-01-01T00:00:01.000Z', type: 'assistant', subtype: 'text', text: 'carrying on' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ category: 'assistant_text' });
  });

  it('keeps a real completion', () => {
    const groups = buildGroups([{ ts: '2026-01-01T00:00:00.000Z', type: 'result', subtype: 'success' }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ category: 'result' });
  });

  it('keeps a result that has no call to pair with', () => {
    const groups = buildGroups([toolResult('orphan')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ category: 'tool_result' });
  });
});

/**
 * Agents do not agree on argument names — Claude's tools send `file_path`,
 * opencode's send `filePath` — and a row that falls through to the raw JSON
 * prints `{"filePath":"/output/prev-upload-sdtm-data-files.json"}` where the
 * filename belongs.
 */
describe('callSummary', () => {
  it('reads a path under either spelling', () => {
    expect(callSummary({ ts: '', tool: 'Read', input: { file_path: '/output/a.json' } })).toBe('/output/a.json');
    expect(callSummary({ ts: '', tool: 'read', input: { filePath: '/output/a.json' } })).toBe('/output/a.json');
  });

  it('shortens a host temp path to the part a reader recognises', () => {
    const summary = callSummary({
      ts: '',
      tool: 'bash',
      input: { command: 'cp "/private/var/folders/78/9k2l68rs1n534_p59cp3kz9w0000gn/T/mediforce-docker-output-Xy9/ae.xpt" /workspace/' },
    });
    expect(summary).not.toContain('9k2l68rs1n534');
    expect(summary).toContain('ae.xpt');
  });

  it('falls back to the raw input only when there is nothing better', () => {
    expect(callSummary({ ts: '', tool: 'Odd', input: { foo: 1 } })).toBe('{"foo":1}');
  });
});

describe('resultSummary', () => {
  it('counts lines when there is something to scan', () => {
    expect(resultSummary({ ts: '', type: 'user', subtype: 'tool_result', content: 'a\nb\nc' })).toBe('3 lines');
  });

  it('says nothing about a short one-line result — a character count is not an outcome', () => {
    expect(resultSummary({ ts: '', type: 'user', subtype: 'tool_result', content: 'ok' })).toBe('');
  });

  it('still reports an empty result, which is worth knowing', () => {
    expect(resultSummary({ ts: '', type: 'user', subtype: 'tool_result', content: '' })).toBe('no output');
  });
});

/**
 * The whole point of the panel: a running step's log grows on screen without a
 * reload. This drives the real 3s poll against changing file contents and
 * asserts the DOM follows.
 */
describe('AgentLogViewer live updates', () => {
  const line = (text: string) =>
    JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', type: 'assistant', subtype: 'text', text });

  function respondWith(content: string) {
    apiFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ content }),
      text: async () => content,
    });
  }

  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows lines that appear after the first fetch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    respondWith(line('first thing'));

    render(
      <AgentLogViewer
        logFiles={[{ stepId: 'extract', file: 'extract.jsonl', executor: 'agent' }]}
        runningStepIds={new Set(['extract'])}
        runActive
      />,
    );
    await waitFor(() => expect(screen.getByText('first thing')).toBeInTheDocument());

    respondWith(`${line('first thing')}\n${line('second thing')}`);
    await vi.advanceTimersByTimeAsync(3_500);

    await waitFor(() => expect(screen.getByText('second thing')).toBeInTheDocument());
  });

  it('asks the browser not to serve the poll from cache', async () => {
    respondWith(line('anything'));
    render(
      <AgentLogViewer
        logFiles={[{ stepId: 'extract', file: 'extract.jsonl', executor: 'agent' }]}
        runningStepIds={new Set(['extract'])}
        runActive
      />,
    );
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());

    expect(apiFetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });
});

/**
 * Searching a step's log: the thing you remember is a filename, a command or a
 * phrase the agent said, not the shape of the record that held it.
 */
describe('entryMatches', () => {
  const read = { ts: '', type: 'assistant', subtype: 'tool_call', tool: 'Read', input: { filePath: '/output/vendors.json' } };
  const said = { ts: '', type: 'assistant', subtype: 'text', text: 'Now I will copy the XPT files' };
  const result = { ts: '', type: 'user', subtype: 'tool_result', content: 'collected 12 vendor records' };

  it('matches everything when the query is empty', () => {
    expect(entryMatches(said, '')).toBe(true);
  });

  it('finds an entry by what the agent said', () => {
    expect(entryMatches(said, 'xpt files')).toBe(true);
  });

  it('finds a tool call by its name or its argument', () => {
    expect(entryMatches(read, 'read')).toBe(true);
    expect(entryMatches(read, 'vendors.json')).toBe(true);
  });

  it('finds a result by its output', () => {
    expect(entryMatches(result, '12 vendor')).toBe(true);
  });

  it('says no when the entry does not contain the query', () => {
    expect(entryMatches(said, 'pharmacovigilance')).toBe(false);
  });
});

describe('AgentLogViewer search', () => {
  const line = (text: string) =>
    JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', type: 'assistant', subtype: 'text', text });

  it('narrows the log to matching entries and drops steps with none', async () => {
    const user = userEvent.setup();
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ content: `${line('copying the XPT files')}\n${line('writing the report')}` }),
      text: async () => '',
    });

    render(
      <AgentLogViewer
        logFiles={[{ stepId: 'extract', file: 'extract.jsonl', executor: 'agent' }]}
        runActive
      />,
    );
    await waitFor(() => expect(screen.getByText('copying the XPT files')).toBeInTheDocument());

    await user.type(screen.getByRole('searchbox', { name: /Search this run/ }), 'report');

    await waitFor(() => expect(screen.queryByText('copying the XPT files')).not.toBeInTheDocument());
    expect(screen.getByText('writing the report')).toBeInTheDocument();
  });
});

/** Search has to match the row as rendered: paths are shortened on screen. */
describe('entryMatches and displayed text', () => {
  const copy = {
    ts: '',
    type: 'assistant',
    subtype: 'tool_call',
    tool: 'bash',
    input: { command: 'cp "/private/var/folders/78/9k2l68rs/T/mediforce-docker-output-Xy9/ae.xpt" /workspace/' },
  };

  it('finds it by the filename shown after the path is shortened', () => {
    expect(entryMatches(copy, 'ae.xpt')).toBe(true);
  });

  it('still finds it by the full path that was actually recorded', () => {
    expect(entryMatches(copy, '/private/var/folders')).toBe(true);
  });
});

/**
 * `<details open>` is read on mount, so React re-asserts it on every render.
 * The log re-renders every 3s poll: without the override map, a step you
 * collapsed springs back open under your cursor.
 */
describe('AgentLogSections collapse', () => {
  it('keeps a step collapsed after the sections are replaced by a poll', async () => {
    const user = userEvent.setup();
    const running = new Set(['validate']);
    const build = () => [section('extract', ['done']), section('validate', ['live'])];

    const { rerender } = render(<AgentLogSections sections={build()} runningStepIds={running} />);

    const open = () => [...document.querySelectorAll('details')].filter((el) => el.open).length;
    expect(open()).toBe(1);

    await user.click(screen.getByText('validate'));
    expect(open()).toBe(0);

    // A poll hands over a fresh array with the same content.
    rerender(<AgentLogSections sections={build()} runningStepIds={running} />);
    expect(open()).toBe(0);
  });
});

/**
 * A step that runs twice writes two log files under the same step id. Keying
 * the list on the step id alone collides, and React then shares one element
 * between two sections — collapsing one closes the other.
 */
describe('AgentLogSections with a step that ran twice', () => {
  const first = { ...section('report', ['first pass']), file: 'report-1.jsonl' };
  const second = { ...section('report', ['second pass']), file: 'report-2.jsonl' };

  it('renders both runs', () => {
    render(<AgentLogSections sections={[first, second]} runningStepIds={new Set()} />);
    expect(screen.getAllByText('report')).toHaveLength(2);
  });

  it('collapses one run without touching the other', async () => {
    const user = userEvent.setup();
    render(<AgentLogSections sections={[first, second]} runningStepIds={new Set(['report'])} />);

    const open = () => [...document.querySelectorAll('details')].filter((el) => el.open).length;
    expect(open()).toBe(2);

    await user.click(screen.getAllByText('report')[0]);
    expect(open()).toBe(1);
  });
});

/**
 * A run with no log files at all renders an empty state. It is also the render
 * that catches a hook placed below that early return: React counts hooks per
 * render, and an early return between them is fatal.
 */
describe('AgentLogViewer with no log files', () => {
  it('renders the empty state without breaking the rules of hooks', () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args[0]); });

    const { rerender } = render(<AgentLogViewer logFiles={[]} />);
    expect(screen.getByText(/No agent log available/)).toBeInTheDocument();

    // A second render is where a mismatched hook count surfaces.
    rerender(<AgentLogViewer logFiles={[]} />);
    expect(screen.getByText(/No agent log available/)).toBeInTheDocument();
    expect(errors).toHaveLength(0);

    spy.mockRestore();
  });

  it('goes from no files to some without changing its hook count', async () => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ content: JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', type: 'assistant', subtype: 'text', text: 'first line' }) }),
      text: async () => '',
    });

    const { rerender } = render(<AgentLogViewer logFiles={[]} />);
    rerender(<AgentLogViewer logFiles={[{ stepId: 'extract', file: 'extract.jsonl', executor: 'agent' }]} />);

    await waitFor(() => expect(screen.getByText('first line')).toBeInTheDocument());
  });
});
