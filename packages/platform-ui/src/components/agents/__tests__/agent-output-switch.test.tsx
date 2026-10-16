import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentOutputSwitch } from '../agent-output-switch';

describe('AgentOutputSwitch', () => {
  it('shows the result first and the closing message on switching, pretty-printing JSON it parsed (#1551)', async () => {
    render(
      <AgentOutputSwitch
        resultSource="result_json"
        agentSummary={{ text: '{"status":"done"}', json: { status: 'done' } }}
        result={<p>grade 3</p>}
      />,
    );

    expect(screen.getByText('grade 3')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'agent_summary.json' }));
    expect(screen.getByTestId('agent-summary').textContent).toBe(JSON.stringify({ status: 'done' }, null, 2));
  });

  it('never calls a result taken from the closing message result.json', () => {
    render(<AgentOutputSwitch resultSource="final_message" agentSummary={{ text: 'done' }} result={<p>grade 3</p>} />);

    expect(screen.getByRole('tab', { name: 'Result (from closing message)' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'result.json' })).toBeNull();
  });

  it('shows the result alone when the run ended without a closing message', () => {
    render(<AgentOutputSwitch resultSource={undefined} agentSummary={null} result={<p>grade 3</p>} />);

    expect(screen.getByText('grade 3')).toBeVisible();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});
