import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigValidationBanner } from '../config-validation-banner';

describe('ConfigValidationBanner', () => {
  it('[RENDER] hidden when no errors and no warnings', () => {
    const { container } = render(
      <ConfigValidationBanner errors={[]} warnings={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('[RENDER] shows red section for errors', () => {
    render(
      <ConfigValidationBanner
        errors={['Missing plugin for step intake']}
        warnings={[]}
      />,
    );
    expect(
      screen.getByText('Missing plugin for step intake'),
    ).toBeInTheDocument();
    // Red error section header
    expect(screen.getByText(/1 error/i)).toBeInTheDocument();
  });

  it('[RENDER] shows amber section for warnings', () => {
    render(
      <ConfigValidationBanner
        errors={[]}
        warnings={['Self-review: same plugin used for executor and reviewer']}
      />,
    );
    expect(
      screen.getByText(
        'Self-review: same plugin used for executor and reviewer',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 warning/i)).toBeInTheDocument();
  });

  it('[RENDER] shows both sections when errors and warnings present', () => {
    render(
      <ConfigValidationBanner
        errors={['Missing plugin']}
        warnings={['Self-review detected']}
      />,
    );
    expect(screen.getByText('Missing plugin')).toBeInTheDocument();
    expect(screen.getByText('Self-review detected')).toBeInTheDocument();
    expect(screen.getByText(/1 error/i)).toBeInTheDocument();
    expect(screen.getByText(/1 warning/i)).toBeInTheDocument();
  });
});
