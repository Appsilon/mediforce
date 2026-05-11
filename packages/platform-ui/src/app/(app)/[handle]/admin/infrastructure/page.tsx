'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Server, HardDrive, Container, AlertTriangle, ArrowUpDown, Trash2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { useDockerImages } from '@/hooks/use-docker-images';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import { cn } from '@/lib/utils';
import type { DockerImageInfo } from '@mediforce/platform-api/contract';

interface WorkflowImageMatch {
  name: string;
  namespace: string;
  title: string | undefined;
  version: number;
  steps: string[];
}

type SortField = 'repository' | 'size' | 'created';
type SortDir = 'asc' | 'desc';

function parseSize(size: string): number {
  const match = size.match(/^([\d.]+)\s*(B|[kKMGT]B)$/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { B: 1, kB: 1000, KB: 1000, MB: 1000 ** 2, GB: 1000 ** 3, TB: 1000 ** 4 };
  return num * (multipliers[unit] ?? 1);
}

function parseAge(created: string): number {
  const match = created.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)/i);
  if (!match) return 0;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const seconds: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };
  return num * (seconds[unit] ?? 0);
}

function humanSize(size: string): string {
  const bytes = parseSize(size);
  if (bytes >= 1000 ** 3) return `${(bytes / 1000 ** 3).toFixed(1)} GB`;
  if (bytes >= 1000 ** 2) return `${(bytes / 1000 ** 2).toFixed(0)} MB`;
  if (bytes >= 1000) return `${(bytes / 1000).toFixed(0)} kB`;
  return size;
}

function sortImages(images: DockerImageInfo[], field: SortField, dir: SortDir): DockerImageInfo[] {
  const sorted = [...images].sort((a, b) => {
    if (field === 'repository') return a.repository.localeCompare(b.repository);
    if (field === 'size') return parseSize(a.size) - parseSize(b.size);
    if (field === 'created') return parseAge(a.created) - parseAge(b.created);
    return 0;
  });
  return dir === 'desc' ? sorted.reverse() : sorted;
}

export default function AdminInfrastructurePage() {
  const params = useParams();
  const rawHandle = params.handle;
  const handle = Array.isArray(rawHandle) ? rawHandle[0] : (rawHandle ?? '');
  const router = useRouter();
  const { canAdmin, loading: roleLoading } = useNamespaceRole(handle);
  const { images, disk, isAvailable, isLoading, refresh } = useDockerImages();
  const [sortField, setSortField] = useState<SortField>('size');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDeleteImage(imageId: string) {
    if (!confirm(`Delete image ${imageId}?`)) return;
    setDeletingId(imageId);
    setDeleteError(null);
    try {
      const res = await apiFetch('/api/admin/docker-images', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        setDeleteError(data.error ?? `Failed to delete (${res.status})`);
      }
      refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete image');
      refresh();
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    if (!roleLoading && !canAdmin) {
      router.replace(`/${handle}`);
    }
  }, [roleLoading, canAdmin, handle, router]);

  const sortedImages = useMemo(
    () => sortImages(images, sortField, sortDir),
    [images, sortField, sortDir],
  );

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'repository' ? 'asc' : 'desc');
    }
  }

  if (roleLoading || isLoading) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/${handle}/settings`} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-lg font-semibold">Infrastructure</h1>
      </div>

      {!isAvailable ? (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">Docker info unavailable</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Container worker is not reachable, or local agent mode is not enabled.
            </p>
          </div>
        </div>
      ) : (
        <>
          {deleteError && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 p-3 flex items-center justify-between">
              <p className="text-sm text-red-700 dark:text-red-400">{deleteError}</p>
              <button onClick={() => setDeleteError(null)} className="text-xs text-red-500 hover:text-red-700">Dismiss</button>
            </div>
          )}
          {disk && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <DiskCard
                icon={<Container className="h-4 w-4" />}
                title="Images"
                count={disk.images.totalCount}
                size={humanSize(disk.images.size)}
              />
              <DiskCard
                icon={<Server className="h-4 w-4" />}
                title="Containers"
                count={disk.containers.totalCount}
                active={disk.containers.active}
                size={humanSize(disk.containers.size)}
              />
              <DiskCard
                icon={<HardDrive className="h-4 w-4" />}
                title="Build Cache"
                size={humanSize(disk.buildCache.size)}
              />
            </div>
          )}

          <div className="rounded-lg border">
            <div className="px-4 py-3 border-b">
              <h2 className="text-sm font-semibold">Docker images</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{images.length} image{images.length !== 1 ? 's' : ''} available on platform</p>
            </div>
            {images.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">No images found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <SortHeader label="Repository" field="repository" current={sortField} dir={sortDir} onSort={toggleSort} />
                      <th className="px-4 py-2 font-medium">Tag</th>
                      <th className="px-4 py-2 font-medium">ID</th>
                      <SortHeader label="Size" field="size" current={sortField} dir={sortDir} onSort={toggleSort} align="right" />
                      <SortHeader label="Created" field="created" current={sortField} dir={sortDir} onSort={toggleSort} align="right" />
                      <th className="px-4 py-2 font-medium w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedImages.map((img, idx) => (
                      <ImageRow
                        key={`${img.id}-${idx}`}
                        img={img}
                        deleting={deletingId === img.id}
                        onDelete={() => handleDeleteImage(img.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SortHeader({ label, field, current, dir, onSort, align }: {
  label: string;
  field: SortField;
  current: SortField;
  dir: SortDir;
  onSort: (f: SortField) => void;
  align?: 'right';
}) {
  const isActive = current === field;
  return (
    <th className={cn('px-4 py-2 font-medium', align === 'right' && 'text-right')}>
      <button
        onClick={() => onSort(field)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground transition-colors',
          isActive && 'text-foreground',
        )}
      >
        {label}
        <ArrowUpDown className={cn('h-3 w-3', isActive ? 'opacity-100' : 'opacity-30')} />
        {isActive && <span className="text-[9px]">{dir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}

function DiskCard({ icon, title, count, active, size }: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  active?: number;
  size: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        {icon}
        <span className="text-xs font-medium">{title}</span>
      </div>
      <p className="text-2xl font-semibold">{size}</p>
      {count !== undefined && (
        <p className="text-xs text-muted-foreground mt-1">
          {count} total{active !== undefined ? `, ${active} active` : ''}
        </p>
      )}
    </div>
  );
}

function ImageRow({ img, deleting, onDelete }: {
  img: DockerImageInfo;
  deleting: boolean;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowImageMatch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const imageRef = `${img.repository}:${img.tag}`;
      const res = await apiFetch(
        `/api/workflow-definitions/by-image?image=${encodeURIComponent(imageRef)}`,
      );
      if (!res.ok) {
        setError(`Failed to load (${res.status})`);
        return;
      }
      const data = await res.json();
      setWorkflows(data.workflows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [img.repository, img.tag]);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && workflows === null && !loading) {
      fetchWorkflows();
    }
  }

  return (
    <>
      <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
        <td className="px-4 py-2 font-mono text-xs">
          <button
            onClick={toggle}
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors text-left"
          >
            {expanded
              ? <ChevronDown className="h-3 w-3 shrink-0" />
              : <ChevronRight className="h-3 w-3 shrink-0" />}
            {img.repository}
          </button>
        </td>
        <td className="px-4 py-2">
          <span className={cn(
            'inline-block rounded-full px-2 py-0.5 text-[10px] font-medium',
            img.tag === 'latest'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-muted text-muted-foreground',
          )}>
            {img.tag}
          </span>
        </td>
        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{img.id}</td>
        <td className="px-4 py-2 text-right text-xs">{humanSize(img.size)}</td>
        <td className="px-4 py-2 text-right text-xs text-muted-foreground">{img.created}</td>
        <td className="px-4 py-2 text-center">
          <button
            onClick={onDelete}
            disabled={deleting}
            className="text-muted-foreground hover:text-red-500 disabled:opacity-30 transition-colors"
            title={`Delete ${img.repository}:${img.tag}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b last:border-0">
          <td colSpan={6} className="px-4 py-3 bg-muted/20">
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading workflows...
              </div>
            )}
            {error && (
              <p className="text-xs text-red-500">{error}</p>
            )}
            {workflows !== null && !loading && (
              workflows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No workflows use this image.</p>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Used by {workflows.length} workflow{workflows.length !== 1 ? 's' : ''}
                  </p>
                  {workflows.map((wf) => (
                    <div key={`${wf.namespace}:${wf.name}`} className="flex items-center gap-2 text-xs">
                      <span className="font-mono">{wf.namespace}/{wf.name}</span>
                      {wf.title && <span className="text-muted-foreground">— {wf.title}</span>}
                      <span className="text-muted-foreground">v{wf.version}</span>
                      <span className="text-muted-foreground">
                        ({wf.steps.length} step{wf.steps.length !== 1 ? 's' : ''})
                      </span>
                    </div>
                  ))}
                </div>
              )
            )}
          </td>
        </tr>
      )}
    </>
  );
}
