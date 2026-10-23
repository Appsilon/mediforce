import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { CollapsibleCard } from '../collapsible-card';

describe('CollapsibleCard', () => {
  it('[RENDER] never flex-shrinks when open outside fill mode, so a tall sibling list cannot squeeze it past overflow-hidden', () => {
    render(
      <CollapsibleCard testId="card" fill={false} open onToggle={() => {}} title="Card">
        content
      </CollapsibleCard>,
    );

    expect(screen.getByTestId('card').className).toContain('shrink-0');
    expect(screen.getByTestId('card').className).not.toContain('flex-1');
  });

  it('[RENDER] grows and shrinks to fill remaining height when open in fill mode', () => {
    render(
      <CollapsibleCard testId="card" open onToggle={() => {}} title="Card">
        content
      </CollapsibleCard>,
    );

    expect(screen.getByTestId('card').className).toContain('flex-1 min-h-0');
    expect(screen.getByTestId('card').className).not.toContain('shrink-0');
  });
});
