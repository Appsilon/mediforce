'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User, GitBranch, Bot, Activity, LogOut, Menu, X, Plus, Play, ChevronDown, Building2, Check, ArrowLeft, ChevronRight, Wrench } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { useAuth } from '@/contexts/auth-context';
import { useAllUserNamespaces } from '@/hooks/use-all-user-namespaces';
import { ThemeToggle } from './theme-toggle';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '', label: 'Workflows', icon: GitBranch, badge: null, exact: true },
  { href: '/runs', label: 'All runs', icon: Play, badge: null, exact: false },
  { href: '/agents', label: 'Agents', icon: Bot, badge: null, exact: false },
  { href: '/tools', label: 'Tools', icon: Wrench, badge: null, exact: false },
  { href: '/tasks', label: 'New actions', icon: User, badge: null, exact: false },
] as const;

const ACTION_ITEMS = [
  { path: '/agents/new', label: 'Add new Agent', icon: Plus, badge: null },
  { path: '/workflows/new', label: 'Add new Workflow', icon: Plus, badge: null },
] as const;

const MONITORING_ITEM = { path: '/monitoring', label: 'Monitoring', icon: Activity } as const;

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  badge?: string | null;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1">{label}</span>
      {badge !== null && badge !== undefined && (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground leading-none">
          {badge}
        </span>
      )}
    </Link>
  );
}

type Crumb = { label: string; href: string | null };

function buildBreadcrumbs(pathname: string, handle: string, prefix: string): Crumb[] {
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  const segments = rest.split('/').filter(Boolean);
  const [s0, s1, s2, s3, s4, s5] = segments;

  const workflows: Crumb = { label: 'Workflows', href: prefix || '/' };

  if (segments.length === 0) return [{ label: 'Workflows', href: null }];

  if (s0 === 'runs') return [workflows, { label: 'All Runs', href: null }];
  if (s0 === 'tasks') return [workflows, { label: 'Tasks', href: null }];
  if (s0 === 'monitoring') return [workflows, { label: 'Monitoring', href: null }];
  if (s0 === 'settings') return [workflows, { label: 'Settings', href: null }];
  if (s0 === 'members') return [workflows, { label: 'Members', href: null }];
  if (s0 === 'catalog') return [workflows, { label: 'Catalog', href: null }];

  if (s0 === 'agents') {
    const agents: Crumb = { label: 'Agents', href: `${prefix}/agents` };
    if (!s1) return [{ ...agents, href: null }];
    if (s1 === 'new') return [agents, { label: 'New Agent', href: null }];
    if (s1 === 'definitions') return [agents, { label: 'Configure Agent', href: null }];
    return [agents];
  }

  if (s0 === 'workflows') {
    if (!s1 || s1 === 'new') return [workflows, { label: 'New Workflow', href: null }];

    const workflowName = decodeURIComponent(s1);
    const workflowHref = `${prefix}/workflows/${s1}`;
    const workflow: Crumb = { label: workflowName, href: workflowHref };

    if (!s2) return [workflows, { ...workflow, href: null }];

    if (s2 === 'definitions' && s3) {
      return [workflows, workflow, { label: `Workflow Editor`, href: null }];
    }

    if (s2 === 'runs' && s3) {
      const runHref = `${prefix}/workflows/${s1}/runs/${s3}`;
      const run: Crumb = { label: `Run`, href: runHref };
      if (s4 === 'steps' && s5) {
        return [workflows, workflow, run, { label: decodeURIComponent(s5).replace(/-/g, ' '), href: null }];
      }
      return [workflows, workflow, { ...run, href: null }];
    }

    return [workflows, workflow];
  }

  return [{ label: 'Workflows', href: null }];
}

function ImgWithFallback({ src, className, fallback }: { src: string; className: string; fallback: React.ReactNode }) {
  const [errored, setErrored] = React.useState(false);
  if (errored) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={className} onError={() => setErrored(true)} />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { firebaseUser, signOut } = useAuth();
  const { namespaces } = useAllUserNamespaces(firebaseUser?.uid);
  const personalNamespace = namespaces.find((ns) => ns.type === 'personal') ?? null;
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  // Extract handle from URL: /{handle}/workflows/... -> handle
  const handleFromPath = pathname.split('/')[1] ?? '';

  // Find the active namespace by matching the handle from the URL
  const activeNamespace = namespaces.find((ns) => ns.handle === handleFromPath) ?? null;
  const activeDisplayName = activeNamespace !== null
    ? (activeNamespace.type === 'personal' ? 'My profile' : activeNamespace.displayName)
    : handleFromPath;

  // Build handle-prefixed href
  const handlePrefix = handleFromPath !== '' ? `/${handleFromPath}` : '';

  const breadcrumbs = buildBreadcrumbs(pathname, handleFromPath, handlePrefix);

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center border-b px-4 gap-2.5">
        <Image src="/logo.png" alt="Mediforce logo" width={32} height={32} className="shrink-0" />
        <span className="font-headline text-lg font-semibold text-primary">Mediforce</span>
      </div>

      {/* Namespace context switcher — below logo */}
      <div className="border-b px-3 py-3">
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-accent transition-colors"
              aria-label="Switch namespace"
            >
              {(() => {
                const avatarSrc = activeNamespace?.avatarUrl ?? (activeNamespace?.type === 'personal' ? firebaseUser?.photoURL : undefined) ?? undefined;
                const avatarFallback = (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary text-xs font-semibold">
                    {activeNamespace !== null && activeNamespace.type === 'organization' ? (
                      <Building2 className="h-3.5 w-3.5" />
                    ) : (
                      firebaseUser?.displayName
                        ? firebaseUser.displayName
                            .split(' ')
                            .slice(0, 2)
                            .map((part) => part[0]?.toUpperCase() ?? '')
                            .join('')
                        : '?'
                    )}
                  </div>
                );
                if (avatarSrc) {
                  return <ImgWithFallback src={avatarSrc} className="h-7 w-7 shrink-0 rounded-md object-cover" fallback={avatarFallback} />;
                }
                return avatarFallback;
              })()}
              <span className="flex-1 truncate text-left text-sm font-medium">
                {activeDisplayName}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="start"
              sideOffset={4}
              className="z-50 w-[260px] rounded-md border bg-popover text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            >
              <div className="py-1">
                {personalNamespace !== null && (
                  <>
                    <Popover.Close asChild>
                      <Link
                        href={`/${personalNamespace.handle}`}
                        className={cn(
                          'flex items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                          handleFromPath === personalNamespace.handle ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {firebaseUser?.photoURL ? (
                          <ImgWithFallback src={firebaseUser.photoURL} className="h-5 w-5 shrink-0 rounded-full object-cover" fallback={<User className="h-4 w-4 shrink-0" />} />
                        ) : (
                          <User className="h-4 w-4 shrink-0" />
                        )}
                        <span className="flex-1 truncate">
                          <span className="block font-medium text-foreground">My profile</span>
                          <span className="block text-xs text-muted-foreground">@{personalNamespace.handle}</span>
                        </span>
                        {handleFromPath === personalNamespace.handle && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                      </Link>
                    </Popover.Close>
                    <div className="my-1 border-t" />
                  </>
                )}
                {namespaces.filter((ns) => ns.type === 'organization').map((ns) => {
                  const isActive = handleFromPath === ns.handle;
                  return (
                    <Popover.Close asChild key={ns.handle}>
                      <Link
                        href={`/${ns.handle}`}
                        className={cn(
                          'flex items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                          isActive ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {ns.avatarUrl ? (
                          <ImgWithFallback src={ns.avatarUrl} className="h-5 w-5 shrink-0 rounded object-cover" fallback={<Building2 className="h-4 w-4 shrink-0" />} />
                        ) : (
                          <Building2 className="h-4 w-4 shrink-0" />
                        )}
                        <span className="flex-1 truncate">
                          <span className="block font-medium text-foreground">{ns.displayName}</span>
                          <span className="block text-xs text-muted-foreground">@{ns.handle}</span>
                        </span>
                        {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                      </Link>
                    </Popover.Close>
                  );
                })}
                <div className="my-1 border-t" />
                <Popover.Close asChild>
                  <Link
                    href="/workspaces/new"
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <Building2 className="h-4 w-4 shrink-0" />
                    <span>Create workspace</span>
                  </Link>
                </Popover.Close>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 p-3">
        {ACTION_ITEMS.map((item) => (
          <NavItem
            key={item.path}
            href={`${handlePrefix}${item.path}`}
            label={item.label}
            icon={item.icon}
            badge={item.badge}
            active={pathname.startsWith(`${handlePrefix}${item.path}`)}
          />
        ))}
        <div className="my-2 border-t" />
        {NAV_ITEMS.map((item) => {
          const fullHref = `${handlePrefix}${item.href}`;
          const isActive = item.exact
            ? pathname === fullHref || pathname === `${fullHref}/`
            : pathname.startsWith(fullHref);
          return (
            <NavItem
              key={item.label}
              href={fullHref}
              label={item.label}
              icon={item.icon}
              badge={item.badge}
              active={isActive}
            />
          );
        })}
        <div className="my-2 border-t" />
        <NavItem
          href={`${handlePrefix}${MONITORING_ITEM.path}`}
          label={MONITORING_ITEM.label}
          icon={MONITORING_ITEM.icon}
          badge={null}
          active={pathname.startsWith(`${handlePrefix}${MONITORING_ITEM.path}`)}
        />
      </nav>

      {/* Bottom — git SHA only */}
      {process.env.NEXT_PUBLIC_GIT_SHA && (
        <div className="border-t px-4 py-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {process.env.NEXT_PUBLIC_GIT_SHA}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar — desktop */}
      <aside className="hidden w-[280px] shrink-0 border-r md:flex md:flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-[280px] border-r bg-background shadow-xl">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b px-4 print:hidden">
          <div className="flex items-center gap-3">
            {/* Mobile menu toggle */}
            <button
              className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Toggle menu"
            >
              {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <nav className="flex items-center gap-1 text-sm">
              {breadcrumbs.length > 1 && (
                <>
                  <Link
                    href={breadcrumbs[breadcrumbs.length - 2].href ?? '#'}
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors mr-2"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Go back
                  </Link>
                  <span className="text-muted-foreground/30">|</span>
                </>
              )}
              {breadcrumbs.map((crumb, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />}
                  {crumb.href !== null ? (
                    <Link href={crumb.href} className="text-muted-foreground hover:text-foreground transition-colors">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="font-medium text-foreground">{crumb.label}</span>
                  )}
                </React.Fragment>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            {firebaseUser && (
              <>
                <span className="text-sm text-muted-foreground hidden sm:block">
                  {firebaseUser.displayName || firebaseUser.email}
                </span>
                <button
                  onClick={signOut}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                  aria-label="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
