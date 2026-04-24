import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { OAuthProviderConfig } from '@mediforce/platform-core';

import { ProviderList, redactClientId } from '../provider-list';

function makeProvider(overrides: Partial<OAuthProviderConfig> = {}): OAuthProviderConfig {
  return {
    id: 'github',
    name: 'GitHub',
    clientId: 'Iv1.abcdef0123456789',
    clientSecret: 'shh',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['repo', 'read:user'],
    createdAt: '2026-04-23T10:00:00.000Z',
    updatedAt: '2026-04-23T10:00:00.000Z',
    ...overrides,
  };
}

describe('redactClientId', () => {
  it('redacts middle of long client id', () => {
    expect(redactClientId('Iv1.abcdef0123456789')).toBe('Iv1.…6789');
  });

  it('returns short ids unchanged', () => {
    expect(redactClientId('abc')).toBe('abc');
    expect(redactClientId('12345678')).toBe('12345678');
  });
});

describe('ProviderList', () => {
  it('renders empty state when no providers', () => {
    render(<ProviderList providers={[]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/No OAuth providers yet/i)).toBeInTheDocument();
  });

  it('renders provider rows with id, name, and redacted client id', () => {
    const providers = [
      makeProvider({ id: 'github', name: 'GitHub', clientId: 'Iv1.abcdef0123456789' }),
      makeProvider({ id: 'google', name: 'Google', clientId: 'shortid8' }),
    ];

    render(<ProviderList providers={providers} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText(/Iv1\.…6789/)).toBeInTheDocument();

    expect(screen.getByText('google')).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText(/shortid8/)).toBeInTheDocument();
  });

  it('calls onSelect with provider id when row clicked', () => {
    const onSelect = vi.fn();
    const providers = [makeProvider({ id: 'github' })];

    render(<ProviderList providers={providers} selectedId={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith('github');
  });

  it('marks the selected row with bg-muted', () => {
    const providers = [makeProvider({ id: 'github' }), makeProvider({ id: 'google' })];

    render(<ProviderList providers={providers} selectedId="github" onSelect={vi.fn()} />);

    const rows = screen.getAllByRole('button');
    expect(rows[0].className.split(/\s+/)).toContain('bg-muted');
    expect(rows[1].className.split(/\s+/)).not.toContain('bg-muted');
  });

  it('renders icon when iconUrl is set', () => {
    const providers = [
      makeProvider({ id: 'github', iconUrl: 'https://example.com/github.svg' }),
    ];

    const { container } = render(
      <ProviderList providers={providers} selectedId={null} onSelect={vi.fn()} />,
    );

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/github.svg');
  });
});
