import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ProcessConfig } from '@mediforce/platform-core';

// ---- Mock useProcessConfigs ----

const mockUseProcessConfigs = vi.fn();
vi.mock('@/hooks/use-process-configs', () => ({
  useProcessConfigs: (...args: unknown[]) => mockUseProcessConfigs(...args),
}));

// ---- Mock next/link to render a plain <a> ----
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { ConfigList } from '../config-list';

const sampleConfigs: ProcessConfig[] = [
  {
    processName: 'supply-chain-review',
    configName: 'default',
    configVersion: '1.0',
    stepConfigs: [
      { stepId: 'intake', executorType: 'human' },
      { stepId: 'review', executorType: 'agent', plugin: 'review-plugin' },
    ],
  },
  {
    processName: 'supply-chain-review',
    configName: 'pilot',
    configVersion: '2.0',
    stepConfigs: [
      { stepId: 'intake', executorType: 'agent', plugin: 'intake-plugin' },
    ],
  },
];

describe('ConfigList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[RENDER] renders loading skeleton while configs are fetching', () => {
    mockUseProcessConfigs.mockReturnValue({ configs: [], loading: true, error: null, refetch: vi.fn() });

    const { container } = render(<ConfigList processName="supply-chain-review" />);

    // Should have skeleton placeholder elements
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('[RENDER] renders empty state message when no configs exist', () => {
    mockUseProcessConfigs.mockReturnValue({ configs: [], loading: false, error: null, refetch: vi.fn() });

    render(<ConfigList processName="supply-chain-review" />);

    expect(screen.getByText(/no configurations yet/i)).toBeInTheDocument();
  });

  it('[DATA] renders config cards with configName, configVersion, and step count', () => {
    mockUseProcessConfigs.mockReturnValue({ configs: sampleConfigs, loading: false, error: null, refetch: vi.fn() });

    render(<ConfigList processName="supply-chain-review" />);

    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByText('1.0')).toBeInTheDocument();
    expect(screen.getByText(/2 steps/)).toBeInTheDocument();

    expect(screen.getByText('pilot')).toBeInTheDocument();
    expect(screen.getByText('2.0')).toBeInTheDocument();
    expect(screen.getByText(/1 step/)).toBeInTheDocument();
  });

  it('[CLICK] each config card links to /configs/{processName}/{configName}/{configVersion}', () => {
    mockUseProcessConfigs.mockReturnValue({ configs: sampleConfigs, loading: false, error: null, refetch: vi.fn() });

    render(<ConfigList processName="supply-chain-review" />);

    const viewLinks = screen.getAllByRole('link', { name: /view/i });
    expect(viewLinks[0]).toHaveAttribute(
      'href',
      '/test-org/configs/supply-chain-review/default/1.0',
    );
    expect(viewLinks[1]).toHaveAttribute(
      'href',
      '/test-org/configs/supply-chain-review/pilot/2.0',
    );
  });

  it('[CLICK] "New Configuration" button links to /configs/new?process={processName}', () => {
    mockUseProcessConfigs.mockReturnValue({ configs: [], loading: false, error: null, refetch: vi.fn() });

    render(<ConfigList processName="supply-chain-review" />);

    const newLink = screen.getByRole('link', { name: /new configuration/i });
    expect(newLink).toHaveAttribute(
      'href',
      '/test-org/configs/new?process=supply-chain-review',
    );
  });

  it('[CLICK] clone link on each config card links correctly', () => {
    mockUseProcessConfigs.mockReturnValue({ configs: sampleConfigs, loading: false, error: null, refetch: vi.fn() });

    render(<ConfigList processName="supply-chain-review" />);

    const cloneLinks = screen.getAllByRole('link', { name: /clone/i });
    expect(cloneLinks[0]).toHaveAttribute(
      'href',
      '/test-org/configs/new?process=supply-chain-review&cloneConfig=default&cloneVersion=1.0',
    );
  });
});
