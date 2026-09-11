import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';
import { createQueryWrapper } from '@/test/react-query';

const listMock = vi.fn();
const getMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();
const archiveVersionMock = vi.fn();
const buildMock = vi.fn();
const apiFetchMock = vi.fn();
const searchParams = new URLSearchParams();

vi.mock('@/lib/mediforce', () => ({
  ApiError: class ApiError extends Error {
    status = 500;
  },
  mediforce: {
    workflows: {
      archiveVersion: (...args: unknown[]) => archiveVersionMock(...args),
    },
    imageCatalog: {
      list: (...args: unknown[]) => listMock(...args),
      get: (...args: unknown[]) => getMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      delete: (...args: unknown[]) => deleteMock(...args),
      build: (...args: unknown[]) => buildMock(...args),
    },
  },
}));

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

// Switchable, because the delete dialog offers the image half only to an
// admin — the gate is behaviour under test, not scenery.
const role = { value: { role: 'member', canAdmin: false, loading: false } };
vi.mock('@/hooks/use-namespace-role', () => ({
  useNamespaceRole: () => role.value,
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
  origin: 'catalogued',
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
  origin: 'catalogued',
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

/** An image a workflow in this workspace built, which nobody has described. */
const DISCOVERED: ImageCatalogEntryView = {
  id: 'cdisc-case-1-1a2b3c4d',
  name: 'cdisc-case-1',
  intent: '',
  source: { kind: 'built', repo: 'git@github.com:vedhav/cdisc-case-1.git', dockerfile: 'Dockerfile' },
  capabilities: {},
  origin: 'discovered',
  availability: 'present',
  baseEntryId: 'golden',
  versions: [
    {
      imageTag: 'mediforce-agent:cdisc-case-1',
      imageId: 'sha256:case-1',
      commit: 'bf0353b123bee14',
      created: '3 minutes ago',
      size: '3.1GB',
      workflow: 'Use Case 1: AI enabled Synthetic Data Generation',
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
  role.value = { role: 'member', canAdmin: false, loading: false };
  deleteMock.mockResolvedValue({ success: true, deletedImages: [] });
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
  archiveVersionMock.mockResolvedValue({ success: true, name: 'sdtm-qc', version: 4 });
  apiFetchMock.mockResolvedValue(pinScan([LIVE_PIN]));
});

/** v4 of a workflow with an older v3 to fall back to, pinning one image. */
const LIVE_PIN = {
  name: 'sdtm-qc',
  namespace: 'acme',
  title: 'SDTM QC',
  version: 4,
  live: true,
  isDefault: false,
  archived: false,
  fallbackVersion: 3 as number | null,
  steps: ['analyse'],
  images: ['mediforce-built:aaaa1111'],
};

function pinScan(workflows: (typeof LIVE_PIN)[]) {
  return { ok: true, json: async () => ({ workflows }) };
}

describe('ImagesPage', () => {
  it('shows an image this workspace built and nobody described, with what to do about it', async () => {
    listMock.mockResolvedValue({ entries: [GOLDEN, DISCOVERED] });

    renderPage();

    const card = await screen.findByTestId('image-entry-cdisc-case-1-1a2b3c4d');
    expect(within(card).getByText('Needs a description')).toBeInTheDocument();
    expect(
      within(card).getByText(/built this image. Nobody has said what it is for yet/),
    ).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Describe' })).toBeInTheDocument();
  });

  it('opens the describe form on the source the build recorded, asking only for the sentence', async () => {
    listMock.mockResolvedValue({ entries: [GOLDEN, DISCOVERED] });
    const user = userEvent.setup();

    renderPage();
    const card = await screen.findByTestId('image-entry-cdisc-case-1-1a2b3c4d');
    await user.click(within(card).getByRole('button', { name: 'Describe' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('git@github.com:vedhav/cdisc-case-1.git · Dockerfile')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveValue('cdisc-case-1');
    expect(within(dialog).getByLabelText('Intent')).toHaveValue('');
  });

  it('leaves a catalogued entry alone — no badge, no describe button', async () => {
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    expect(within(card).queryByText('Needs a description')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Describe' })).not.toBeInTheDocument();
  });

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
      within(await screen.findByTestId('image-entry-tealflow')).getByRole('button', { expanded: false }),
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
      within(await screen.findByTestId('image-entry-tealflow')).getByRole('button', { expanded: false }),
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
      within(await screen.findByTestId('image-entry-tealflow')).getByRole('button', { expanded: false }),
    );

    const derived = screen.getByTestId('image-entry-tealflow');
    expect(await within(derived).findByText('current')).toBeInTheDocument();
    expect(within(derived).getByText('superseded')).toBeInTheDocument();
    expect(await within(derived).findByText('unused')).toBeInTheDocument();
  });

  it('resolves used by to the workflow and its step', async () => {
    renderPage();

    await userEvent.click(
      within(await screen.findByTestId('image-entry-tealflow')).getByRole('button', { expanded: false }),
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
      within(await screen.findByTestId('image-entry-tealflow')).getByRole('button', { expanded: false }),
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
      within(await screen.findByTestId('image-entry-tealflow')).getByRole('button', { expanded: false }),
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
      within(await screen.findByTestId('image-entry-tealflow')).getByRole('button', { expanded: false }),
    );

    expect(await screen.findByText(/is not a GitHub repository/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Open / })).not.toBeInTheDocument();
  });

  it('catalogues a source nobody has built here, from the repository and Dockerfile', async () => {
    createMock.mockResolvedValue({ entry: { ...TEALFLOW, id: 'added' } });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /Add image/ }));

    await userEvent.type(screen.getByLabelText('Repository'), 'Appsilon/tealflow');
    await userEvent.type(screen.getByLabelText(/Dockerfile/), 'container/Dockerfile');
    await userEvent.type(screen.getByLabelText('Intent'), 'R-based exploration of ADaM datasets');

    // The name is suggested from the repository rather than left blank, the
    // same way a discovered entry arrives named.
    expect(screen.getByLabelText('Name')).toHaveValue('tealflow');

    await userEvent.click(screen.getByRole('button', { name: 'Add to the catalog' }));

    expect(createMock).toHaveBeenCalledWith({
      namespace: 'acme',
      name: 'tealflow',
      intent: 'R-based exploration of ADaM datasets',
      source: { kind: 'built', repo: 'Appsilon/tealflow', dockerfile: 'container/Dockerfile' },
    });
  });

  it('sends the empty Dockerfile as the value it is, not as an absence', async () => {
    createMock.mockResolvedValue({ entry: { ...TEALFLOW, id: 'added' } });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /Add image/ }));
    await userEvent.type(screen.getByLabelText('Repository'), 'Appsilon/tealflow');
    await userEvent.type(screen.getByLabelText('Intent'), 'Whatever the default Dockerfile builds');
    await userEvent.click(screen.getByRole('button', { name: 'Add to the catalog' }));

    // `deriveBuildTag` folds in `dockerfile ?? ''`, so the entry keyed on the
    // empty string is the one an image built without a Dockerfile matches.
    expect(createMock.mock.calls[0][0].source).toEqual({
      kind: 'built',
      repo: 'Appsilon/tealflow',
      dockerfile: '',
    });
  });

  it('keeps a name the author typed instead of overwriting it from the repository', async () => {
    createMock.mockResolvedValue({ entry: { ...TEALFLOW, id: 'added' } });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /Add image/ }));
    await userEvent.type(screen.getByLabelText('Name'), 'TealFlow agent');
    await userEvent.type(screen.getByLabelText('Repository'), 'Appsilon/tealflow');

    expect(screen.getByLabelText('Name')).toHaveValue('TealFlow agent');
  });

  it('leads a failed build with the cause and keeps the output behind a disclosure', async () => {
    buildMock.mockRejectedValue(
      new Error(
        'Building "mediforce-built:d999" failed: Command failed: docker build …\n' +
          '#7 [5/6] COPY mcp/ /opt/golden-standard/mcp/\n' +
          'ERROR: failed to build: failed to solve: failed to compute cache key: ' +
          'failed to calculate checksum of ref abc::def: "/mcp": not found',
      ),
    );
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await userEvent.click(within(card).getByRole('button', { name: 'Build' }));
    await userEvent.type(screen.getByLabelText('Commit'), 'e56cba94021b4385');
    await userEvent.click(screen.getByRole('button', { name: 'Build' }));

    // The rule, not the raw output: the copied path exists in the repository,
    // so the unexplained failure reads as a platform bug.
    expect(await screen.findByText(/build context is the directory holding the Dockerfile/i))
      .toBeInTheDocument();
    expect(screen.queryByText(/failed to compute cache key/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Show full error/ }));

    expect(screen.getByText(/failed to compute cache key/)).toBeInTheDocument();
  });

  it('states the build-context rule before a build is attempted', async () => {
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await userEvent.click(within(card).getByRole('button', { name: 'Build' }));

    expect(
      screen.getByText(/Everything the Dockerfile/),
    ).toBeInTheDocument();
  });

  it('offers Edit on a catalogued entry, prefilled with what the entry says today', async () => {
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await user.click(within(card).getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    // Every field a human wrote, seeded from the entry — including the source,
    // which is what makes a mistyped repository fixable rather than permanent.
    expect(within(dialog).getByLabelText('Repository')).toHaveValue('Appsilon/tealflow');
    expect(within(dialog).getByLabelText(/Dockerfile/)).toHaveValue('container/Dockerfile');
    expect(within(dialog).getByLabelText('Name')).toHaveValue('TealFlow agent');
    expect(within(dialog).getByLabelText('Intent')).toHaveValue(
      'R-based interactive exploration of ADaM datasets',
    );
  });

  it('patches the entry it was opened on, leaving the source out of the write', async () => {
    updateMock.mockResolvedValue({ entry: { ...TEALFLOW, name: 'TealFlow explorer' } });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await user.click(within(card).getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'TealFlow explorer');
    await user.clear(within(dialog).getByLabelText('Intent'));
    await user.type(within(dialog).getByLabelText('Intent'), 'Exploring ADaM in a sandbox');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(updateMock).toHaveBeenCalledWith({
      namespace: 'acme',
      id: 'tealflow',
      name: 'TealFlow explorer',
      intent: 'Exploring ADaM in a sandbox',
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('describes an undescribed entry instead of patching it — there is no row yet', async () => {
    listMock.mockResolvedValue({ entries: [GOLDEN, DISCOVERED] });
    createMock.mockResolvedValue({ entry: { ...DISCOVERED, origin: 'catalogued' } });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-cdisc-case-1-1a2b3c4d');
    expect(within(card).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Describe' }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Intent'), 'Synthetic SDTM generation');
    await user.click(within(dialog).getByRole('button', { name: 'Add to the catalog' }));

    // A discovered entry is derived on read, not stored, so there is nothing to
    // PATCH. The id derives from the source, so the create lands at the
    // identity the listing was already showing (ADR-0022 decision 7).
    expect(createMock).toHaveBeenCalledWith({
      namespace: 'acme',
      name: 'cdisc-case-1',
      intent: 'Synthetic SDTM generation',
      source: DISCOVERED.source,
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('re-points a mistyped repository, sending the corrected source', async () => {
    updateMock.mockResolvedValue({ entry: { ...TEALFLOW, id: 'tealflow-corrected' } });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await user.click(within(card).getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Repository'));
    await user.type(within(dialog).getByLabelText('Repository'), 'Appsilon/tealflow-gpu');

    // The entry is keyed on its source, so the save moves it — said before the
    // click, not discovered afterwards.
    expect(within(dialog).getByText(/keyed on its source, so this moves it/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(updateMock).toHaveBeenCalledWith({
      namespace: 'acme',
      id: 'tealflow',
      name: 'TealFlow agent',
      intent: 'R-based interactive exploration of ADaM datasets',
      source: { kind: 'built', repo: 'Appsilon/tealflow-gpu', dockerfile: 'container/Dockerfile' },
    });
  });

  it('edits the Dockerfile path on its own, keeping the repository', async () => {
    updateMock.mockResolvedValue({ entry: TEALFLOW });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await user.click(within(card).getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText(/Dockerfile/));
    await user.type(within(dialog).getByLabelText(/Dockerfile/), 'container/Dockerfile.gpu');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(updateMock.mock.calls[0][0].source).toEqual({
      kind: 'built',
      repo: 'Appsilon/tealflow',
      dockerfile: 'container/Dockerfile.gpu',
    });
  });

  it('leaves the source out of a patch that only touches the sentence', async () => {
    updateMock.mockResolvedValue({ entry: TEALFLOW });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await user.click(within(card).getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Intent'));
    await user.type(within(dialog).getByLabelText('Intent'), 'Exploring ADaM in a sandbox');
    // No re-key, so no warning and no `source` on the wire: an edit to the
    // sentence stays an edit to the sentence.
    expect(within(dialog).queryByText(/keyed on its source/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(updateMock.mock.calls[0][0]).not.toHaveProperty('source');
  });

  it('offers the reference, not a repository, for an entry the platform never built', async () => {
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-golden');
    await user.click(within(card).getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Image reference')).toHaveValue('mediforce-golden-image');
    // There are no build inputs for a referenced source, so there is no
    // repository to name and offering one would invent a field.
    expect(within(dialog).queryByLabelText('Repository')).not.toBeInTheDocument();
  });

  it('shows a discovered entry its recorded source without offering to re-point it', async () => {
    listMock.mockResolvedValue({ entries: [GOLDEN, DISCOVERED] });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-cdisc-case-1-1a2b3c4d');
    await user.click(within(card).getByRole('button', { name: 'Describe' }));

    const dialog = await screen.findByRole('dialog');
    // A build recorded this source. Re-pointing it here would describe some
    // other source and leave this one still undescribed.
    expect(
      within(dialog).getByText('git@github.com:vedhav/cdisc-case-1.git \u00b7 Dockerfile'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Repository')).not.toBeInTheDocument();
  });

  it('offers no Delete to a member — retiring an entry takes its images', async () => {
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    // A member may still add an entry; deleting one destroys artifacts on a
    // daemon every workspace shares.
    expect(within(card).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('refuses to delete while a live workflow version pins one of the images', async () => {
    role.value = { role: 'admin', canAdmin: true, loading: false };
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await user.click(within(card).getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByTestId('delete-blocked')).toBeInTheDocument();
    expect(within(dialog).getByText(/acme\/sdtm-qc v4/)).toBeInTheDocument();
    // Blocked, not warned: the author can still re-point that step, so nobody
    // has to choose to break it.
    expect(
      within(dialog).getByRole('button', { name: 'Delete entry and 2 images' }),
    ).toBeDisabled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('archives the blocking version in place, rather than the whole workflow', async () => {
    role.value = { role: 'admin', canAdmin: true, loading: false };
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('delete-blocked');

    // Archiving v4 changes what runs, so the dialog says what that is.
    expect(within(dialog).getByText(/runs fall back to v3/)).toBeInTheDocument();
    apiFetchMock.mockResolvedValue(pinScan([{ ...LIVE_PIN, live: false, archived: true }]));
    await user.click(within(dialog).getByRole('button', { name: 'Archive v4' }));

    expect(archiveVersionMock).toHaveBeenCalledWith(
      { name: 'sdtm-qc', version: 4, archived: true },
      { namespace: 'acme' },
    );
    // The rescan says nothing live pins it any more, so the delete unblocks
    // without a reload.
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Delete entry and 2 images' }),
      ).toBeEnabled(),
    );
  });

  it('stays blocked when the version runs fall back to pins the image too', async () => {
    role.value = { role: 'admin', canAdmin: true, loading: false };
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('delete-blocked');

    apiFetchMock.mockResolvedValue(
      pinScan([
        { ...LIVE_PIN, live: false, archived: true },
        { ...LIVE_PIN, version: 3, fallbackVersion: null },
      ]),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Archive v4' }));

    // Archiving v4 handed runs to v3, which pins the same image — only the
    // fresh answer knows that, so the button never enables in between.
    expect(await within(dialog).findByText(/acme\/sdtm-qc v3/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Delete entry and 2 images' }),
    ).toBeDisabled();
  });

  it('names archiving a workflow\'s only runnable version for what it is', async () => {
    role.value = { role: 'admin', canAdmin: true, loading: false };
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        workflows: [
          {
            name: 'sdtm-qc',
            namespace: 'acme',
            title: 'SDTM QC',
            version: 1,
            live: true,
            isDefault: false,
            archived: false,
            fallbackVersion: null,
            steps: ['analyse'],
            images: ['mediforce-built:aaaa1111'],
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('delete-blocked');

    // Nothing is left to run once v1 goes, so the workflow goes with it — the
    // button says so, and where to get it back.
    expect(within(dialog).queryByRole('button', { name: 'Archive v1' })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Archived workflows/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Archive workflow' }));

    expect(archiveVersionMock).toHaveBeenCalledWith(
      { name: 'sdtm-qc', version: 1, archived: true },
      { namespace: 'acme' },
    );
  });

  it('will not archive a version the workflow pins as its default', async () => {
    role.value = { role: 'admin', canAdmin: true, loading: false };
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        workflows: [
          {
            name: 'sdtm-qc',
            namespace: 'acme',
            title: 'SDTM QC',
            version: 4,
            live: true,
            isDefault: true,
            archived: false,
            steps: ['analyse'],
            images: ['mediforce-built:aaaa1111'],
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('delete-blocked');

    // Archiving a chosen default leaves the workflow pointing at something
    // that cannot run — a worse outcome than the image staying.
    expect(within(dialog).queryByRole('button', { name: /Archive v/ })).not.toBeInTheDocument();
    expect(within(dialog).getByText('default version')).toBeInTheDocument();
  });

  it('deletes entry and images when only a superseded version pins them', async () => {
    role.value = { role: 'admin', canAdmin: true, loading: false };
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        workflows: [
          {
            name: 'sdtm-qc',
            namespace: 'acme',
            title: 'SDTM QC',
            version: 2,
            live: false,
            isDefault: false,
            archived: false,
            steps: ['analyse'],
            images: ['mediforce-built:aaaa1111'],
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');

    // Listed, so the loss is seen — but not blocking, because a registered
    // version is immutable and could never be re-pointed.
    expect(await within(dialog).findByText(/superseded version/)).toBeInTheDocument();
    expect(within(dialog).queryByTestId('delete-blocked')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Delete entry and 2 images' }));

    expect(deleteMock).toHaveBeenCalledWith({
      namespace: 'acme',
      id: 'tealflow',
      withImages: true,
    });
  });

  it('removes only the record when the daemon holds no image for the entry', async () => {
    role.value = { role: 'admin', canAdmin: true, loading: false };
    listMock.mockResolvedValue({
      entries: [{ ...TEALFLOW, availability: 'absent', versions: [] }],
    });
    getMock.mockResolvedValue({
      entry: { ...TEALFLOW, availability: 'absent', versions: [] },
    });
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await user.click(within(card).getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/removes the record and nothing else/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete entry' }));

    // No `withImages`: there is nothing on the daemon to remove, so the
    // destructive half is not claimed.
    expect(deleteMock).toHaveBeenCalledWith({ namespace: 'acme', id: 'tealflow' });
  });

  it('keeps the dialog open and explains a refusal from the daemon', async () => {
    role.value = { role: 'admin', canAdmin: true, loading: false };
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ workflows: [] }) });
    deleteMock.mockRejectedValue(
      new Error('conflict: unable to delete (must be forced) - image is being used'),
    );
    const user = userEvent.setup();
    renderPage();

    const card = await screen.findByTestId('image-entry-tealflow');
    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(
      await within(dialog).findByRole('button', { name: 'Delete entry and 2 images' }),
    );

    expect(await within(dialog).findByText(/image is being used/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Nothing was removed/)).toBeInTheDocument();
  });
});
