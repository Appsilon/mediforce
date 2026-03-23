'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User, GitBranch, Bot, Activity, LogOut, Menu, X, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { ThemeToggle } from './theme-toggle';
import { cn } from '@/lib/utils';

const ACTION_ITEMS = [
  { href: '/agents/new', label: 'Add new Agent', icon: Plus, badge: null },
  { href: '/workflows/new', label: 'Add new Workflow', icon: Plus, badge: null },
] as const;

const NAV_ITEMS = [
  { href: '/workflows', label: 'Workflows', icon: GitBranch, badge: null },
  { href: '/agents', label: 'Agents', icon: Bot, badge: null },
  { href: '/tasks', label: 'Human Actions', icon: User, badge: null },
] as const;

const MONITORING_ITEM = { href: '/monitoring', label: 'Monitoring', icon: Activity } as const;

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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { firebaseUser, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  const currentLabel =
    [...NAV_ITEMS, MONITORING_ITEM].find((item) => pathname.startsWith(item.href))?.label ??
    'Mediforce';

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center border-b px-4 gap-2.5">
        <Image src="/logo.png" alt="Mediforce logo" width={32} height={32} className="shrink-0" />
        <span className="font-headline text-lg font-semibold text-primary">Mediforce</span>
      </div>
      {/* Nav */}
      <nav className="flex-1 space-y-1 p-3">
        {ACTION_ITEMS.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            badge={item.badge}
            active={pathname.startsWith(item.href)}
          />
        ))}
        <div className="my-2 border-t" />
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            badge={item.badge}
            active={pathname.startsWith(item.href)}
          />
        ))}
        <div className="my-2 border-t" />
        <NavItem
          href={MONITORING_ITEM.href}
          label={MONITORING_ITEM.label}
          icon={MONITORING_ITEM.icon}
          badge={null}
          active={pathname.startsWith(MONITORING_ITEM.href)}
        />
      </nav>
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
            <span className="text-sm font-medium text-foreground">{currentLabel}</span>
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
