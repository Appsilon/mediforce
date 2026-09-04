import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';
import { createQueryWrapper } from '@/test/react-query';

const listMock = vi.fn();
const getMock = vi.fn();
const apiFetchMock = vi.fn();
const searchParams = new URLSearchParams();

vi.mock('@/lib/mediforce', () => ({
  ApiError: class ApiError extends Error {
    status = 500;
  },
  mediforce: {
    imageCatalog: {
      list: (...args: unknown[]) => listMock(...args),
      get: (...args: unknown[]) => getMock(...args),
    },
  },
}));

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock('@/hooks/use-namespace-role', () => ({
  useNamespaceRole: () => ({ role: 'member', canAdmin: false, loading: false }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ handle: 'acme' }),
  useSearchParams: () => searchParams,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import ImagesPage from '../page';

const GOLDEN: ImageCatalogEntryView = {
  id: 'golden',
  name: 'Golden image',
  intent: 'The image every agent step runs in unless a workflow says otherwise',
  source: { kind: 'referenced', reference: 'mediforce-golden-image' },
  capabilities: {},
  availability: 'present',
  baseEntryId: null,
  versions: [
    {
      imageTag: 'mediforce-golden-image:latest',
      imageId: 'sha256:golden',
      created: '3 weeks ago',
      size: '2.1GB',
      capabilities: { status: 'known', agentCapable: true, runtimes: ['bash', 'claude', 'python3'] },
      lineage: { base: null, ownLabels: {} },
    },
  ],
};

const TEALFLOW: ImageCatalogEntryView = {
  id: 'tealflow',
  name: 'TealFlow agent',
  intent: 'R-based interactive exploration of ADaM datasets',
  source: { kind: 'built', repo: 'Appsilon/tealflow', dockerfile: 'container/Dockerfile' },
  capabilities: {},
  availability: 'present',
  baseEntryId: 'golden',
  versions: [
    {
      imageTag: 'mediforce-built:aaaa1111',
      imageId: 'sha256:teal-new',
      commit: 'c0ffee1234567',
      created: '2 days ago',
      size: '2.4GB',
      capabilities: { status: 'known', agentCapable: true, runtimes: ['Rscript', 'bash', 'claude'] },
      lineage: {
        base: { entryId: 'golden', imageId: 'sha256:golden', imageTag: 'mediforce-golden-image:latest' },
        ownLabels: {},
      },
    },
    {
      imageTag: 'mediforce-built:bbbb2222',
      imageId: 'sha256:teal-old',
      commit: 'deadbee7654321',
      created: '3 weeks ago',
      size: '2.4GB',
      capabilities: { status: 'unknown' },
      lineage: {
        base: { entryId: 'golden', imageId: 'sha256:golden', imageTag: 'mediforce-golden-image:latest' },
        ownLabels: {},
      },
    },
  ],
};

function renderPage() {
  const { wrapper: Wrapper } = createQueryWrapper();
  return render(
    <Wrapper>
      <ImagesPage />
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue({ entries: [GOLDEN, TEALFLOW] });
  getMock.mockResolvedValue({
    entry: {
      ...TEALFLOW,
      versions: [
        {
          ...TEALFLOW.versions[0],
          lineage: {
            ...TEALFLOW.versions[0].lineage,
            addedSteps: [
              { command: 'RUN CDISC_RULES_ENGINE_REF=*** git clone https://example.com/x', size: '120MB' },
              { command: 'COPY container/run_stage.py /app/run_stage.py', size: '4kB' },
            ],
          },
        },
        {
          ...TEALFLOW.versions[1],
          lineage: {
            ...TEALFLOW.versions[1].lineage,
            addedSteps: [{ command: 'RUN install2.r teal', size: '80MB' }],
          },
        },
      ],
    },
  });
  apiFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      workflows: [
        {
          name: 'sdtm-qc',
          namespace: 'acme',
          title: 'SDTM QC',
          version: 4,
          steps: ['analyse'],
          images: ['mediforce-built:aaaa1111'],
        },
      ],
    }),
  });
});

describe('ImagesPage', () => {
  it('groups an entry under the image it was built on, not alphabetically', async () => {
    renderPage();

    const derived = await screen.findByTestId('image-entry-tealflow');
    expect(within(derived).getByText('Built on Golden image')).toBeInTheDocument();
    expect(screen.getByTestId('image-entry-golden')).toBeInTheDocument();
  });

  it('shows the required intent sentence and the probed capabilities as chips', async () => {
    renderPage();

    expect(
      await screen.findByText('R-based interactive exploration of ADaM datasets'),
    ).toBeInTheDocument();
    const derived = screen.getByTestId('image-entry-tealflow');
    expect(within(derived).getByText('Rscript')).toBeInTheDocument();
    expect(within(derived).getByText('agent-capable')).toBeInTheDocument();
  });

  it('searches on capability text, not just the image name', async () => {
    renderPage();
    await screen.findByTestId('image-entry-tealflow');

    await userEvent.type(screen.getByLabelText('Search images'), 'Rscript');

    expect(screen.getByTestId('image-entry-tealflow')).toBeInTheDocument();
    expect(screen.queryByTestId('image-entry-golden')).not.toBeInTheDocument();
  });

  it('links each version to its Dockerfile at the pinned commit', async () => {
    renderPage();

    await userEvent.click(
      within(await screen.findByTestId('image-entry-tealflow')).getByRole('button'),
    );

    const link = await screen.findByRole('link', {
      name: /Open container\/Dockerfile at c0ffee1/,
    });
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/Appsilon/tealflow/blob/c0ffee1234567/container/Dockerfile',
    );
  });

  it('calls the layer delta layer commands, never the Dockerfile', async () => {
    renderPage();

    await userEvent.click(
      within(await screen.findByTestId('image-entry-tealflow')).getByRole('button'),
    );

    expect(
      await screen.findByText(/2 layer commands added over mediforce-golden-image:latest/),
    ).toBeInTheDocument();
    expect(screen.getByText(/not a Dockerfile/)).toBeInTheDocument();
    expect(
      screen.getByText('RUN CDISC_RULES_ENGINE_REF=*** git clone https://example.com/x'),
    ).toBeInTheDocument();
  });

  it('marks the superseded version and the one no workflow pins', async () => {
    renderPage();

    await userEvent.click(
      within(await screen.findByTestId('image-entry-tealflow')).getByRole('button'),
    );

    const derived = screen.getByTestId('image-entry-tealflow');
    expect(await within(derived).findByText('current')).toBeInTheDocument();
    expect(within(derived).getByText('superseded')).toBeInTheDocument();
    expect(await within(derived).findByText('unused')).toBeInTheDocument();
  });

  it('resolves used by to the workflow and its step', async () => {
    renderPage();

    await userEvent.click(
      within(await screen.findByTestId('image-entry-tealflow')).getByRole('button'),
    );

    expect(await screen.findByRole('link', { name: 'SDTM QC' })).toHaveAttribute(
      'href',
      '/acme/workflows/sdtm-qc',
    );
    expect(screen.getByText(/acme\/sdtm-qc v4 · analyse/)).toBeInTheDocument();
  });

  it('carries a layer summary on every version, not only the current one', async () => {
    renderPage();

    await userEvent.click(
      within(await screen.findByTestId('image-entry-tealflow')).getByRole('button'),
    );
    await screen.findByText(/2 layer commands added over/);

    // The superseded version's summary is collapsed, not missing: the entry
    // read computes one per version, so every version can be inspected.
    const superseded = screen.getByText('mediforce-built:bbbb2222').closest('li');
    expect(superseded).not.toBeNull();
    await userEvent.click(
      within(superseded as HTMLElement).getByRole('button', {
        name: /adds over its base/i,
      }),
    );

    expect(
      await within(superseded as HTMLElement).findByText('RUN install2.r teal'),
    ).toBeInTheDocument();
  });

  it('names a workflow in a workspace the reader has not joined, without linking into it', async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        workflows: [
          {
            name: 'shared-qc',
            namespace: 'beta',
            title: 'Shared QC',
            version: 2,
            steps: ['analyse'],
            images: ['mediforce-built:aaaa1111'],
          },
        ],
      }),
    });
    renderPage();

    await userEvent.click(
      within(await screen.findByTestId('image-entry-tealflow')).getByRole('button'),
    );

    expect(await screen.findByText('Shared QC')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Shared QC' })).not.toBeInTheDocument();
  });

  it('renders an entry whose image is gone from the daemon as unavailable', async () => {
    listMock.mockResolvedValue({
      entries: [{ ...GOLDEN, availability: 'absent', versions: [] }],
    });
    renderPage();

    const entry = await screen.findByTestId('image-entry-golden');
    expect(within(entry).getByText('Unavailable')).toBeInTheDocument();
  });

  it('never offers a link for a non-GitHub repo, and says why', async () => {
    const gitlab = {
      ...TEALFLOW,
      baseEntryId: null,
      source: {
        kind: 'built' as const,
        repo: 'https://gitlab.com/team/tealflow',
        dockerfile: 'Dockerfile',
      },
      versions: [TEALFLOW.versions[0]],
    };
    listMock.mockResolvedValue({ entries: [gitlab] });
    getMock.mockResolvedValue({ entry: gitlab });
    renderPage();

    await userEvent.click(
      within(await screen.findByTestId('image-entry-tealflow')).getByRole('button'),
    );

    expect(await screen.findByText(/is not a GitHub repository/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Open / })).not.toBeInTheDocument();
  });
});
