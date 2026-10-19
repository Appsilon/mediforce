import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JsonDataView } from '../json-data-view';

const PR_BODY = '## Summary\n\nFixes the **Hy\'s Law** check.\n\n- [x] tests';

const RESULT = {
  ctcaeGrade: 3,
  drug_name: 'Keytruda',
  pr_body: PR_BODY,
  findings: [
    { id: 'SDTM-AE-01', severity: 'critical', message: 'AESTDTC after AEENDTC', domain: 'AE' },
    { id: 'SDTM-AE-02', severity: 'minor', message: 'AETERM not coded', domain: 'AE' },
  ],
  mapping_yaml: 'domains:\n  - AE\n  - LB\n',
};

describe('JsonDataView', () => {
  it('opens formatted: short fields as labelled values, markdown rendered, rules as cards, YAML as a code block', () => {
    render(<JsonDataView value={RESULT} />);

    expect(screen.getByText('Ctcae Grade')).toBeInTheDocument();
    expect(screen.getByText('Keytruda')).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.queryByText(/## Summary/)).not.toBeInTheDocument();

    expect(screen.getByText('SDTM-AE-01')).toBeInTheDocument();
    expect(screen.getByText('AESTDTC after AEENDTC')).toBeInTheDocument();
    expect(screen.getByText('critical')).toBeInTheDocument();

    expect(screen.getByText('Mapping Yaml')).toBeInTheDocument();
    expect(screen.getByText('4 lines')).toBeInTheDocument();
  });

  it('switches to the raw JSON and back', async () => {
    const user = userEvent.setup();
    render(<JsonDataView value={RESULT} />);

    await user.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.getByTestId('json-raw').textContent).toBe(JSON.stringify(RESULT, null, 2));
    expect(screen.queryByRole('heading', { name: 'Summary' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Formatted' }));
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
  });

  it('formats a top-level array of objects as cards', () => {
    render(<JsonDataView value={[{ subject: 'S-001', grade: 3 }, { subject: 'S-002', grade: 5 }]} />);

    const formatted = screen.getByTestId('json-formatted');
    expect(within(formatted).getAllByText('Subject')).toHaveLength(2);
    expect(within(formatted).getByText('S-002')).toBeInTheDocument();
  });

  it('says so when the object has no fields to show', () => {
    render(<JsonDataView value={{ empty: '', none: null }} />);

    expect(screen.getByText('No fields to show.')).toBeInTheDocument();
  });
});
