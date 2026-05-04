'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Server, HardDrive, Container, AlertTriangle } from 'lucide-react';
import { useDockerImages } from '@/hooks/use-docker-images';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import { cn } from '@/lib/utils';

export default function AdminInfrastructurePage() {
  const params = useParams();
  const rawHandle = params.handle;
  const handle = Array.isArray(rawHandle) ? rawHandle[0] : (rawHandle ?? '');
  const router = useRouter();
  const { canAdmin, loading: roleLoading } = useNamespaceRole(handle);
  const { images, disk, isAvailable, isLoading } = useDockerImages();

  useEffect(() => {
    if (!roleLoading && !canAdmin) {
      router.replace(`/${handle}`);
    }
  }, [roleLoading, canAdmin, handle, router]);

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
        <Link href={`/${handle}`} className="text-muted-foreground hover:text-foreground transition-colors">
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
          {/* Disk usage cards */}
          {disk && (
            <div className="grid grid-cols-3 gap-4">
              <DiskCard
                icon={<Container className="h-4 w-4" />}
                title="Images"
                count={disk.images.totalCount}
                size={disk.images.size}
              />
              <DiskCard
                icon={<Server className="h-4 w-4" />}
                title="Containers"
                count={disk.containers.totalCount}
                active={disk.containers.active}
                size={disk.containers.size}
              />
              <DiskCard
                icon={<HardDrive className="h-4 w-4" />}
                title="Build Cache"
                size={disk.buildCache.size}
              />
            </div>
          )}

          {/* Images table */}
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
                      <th className="px-4 py-2 font-medium">Repository</th>
                      <th className="px-4 py-2 font-medium">Tag</th>
                      <th className="px-4 py-2 font-medium">ID</th>
                      <th className="px-4 py-2 font-medium text-right">Size</th>
                      <th className="px-4 py-2 font-medium text-right">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {images.map((img, idx) => (
                      <tr key={`${img.id}-${idx}`} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2 font-mono text-xs">{img.repository}</td>
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
                        <td className="px-4 py-2 text-right text-xs">{img.size}</td>
                        <td className="px-4 py-2 text-right text-xs text-muted-foreground">{img.created}</td>
                      </tr>
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
