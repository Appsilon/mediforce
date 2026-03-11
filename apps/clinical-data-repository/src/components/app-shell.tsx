'use client';

import { usePathname } from 'next/navigation';
import { SidebarNav } from './sidebar-nav';
import { Separator } from './ui/separator';
import { Activity } from 'lucide-react';

const PAGE_TITLES: Record<string, string> = {
  '/requirements': 'Requirements',
  '/study-data': 'Study Data',
  '/validation-issues': 'Validation Issues',
  '/validation-rules': 'Validation Rules',
};

function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/file-viewer/')) {
    return 'File Viewer';
  }
  return PAGE_TITLES[pathname] ?? 'Clinical Data Repository';
}

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r bg-sidebar">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <Activity className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold font-headline leading-none text-sidebar-foreground">
              Mediforce
            </p>
            <p className="text-[10px] text-muted-foreground leading-none mt-0.5">
              Clinical Data Hub
            </p>
          </div>
        </div>
        <Separator />
        <div className="flex-1 overflow-y-auto py-3">
          <SidebarNav />
        </div>
        <Separator />
        <div className="p-4">
          <p className="text-xs text-muted-foreground">Study: MF-2024-001</p>
          <p className="text-xs text-muted-foreground">Phase III — Q4 2024</p>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-14 items-center border-b bg-background px-6">
          <h1 className="text-base font-semibold font-headline text-foreground">{pageTitle}</h1>
        </header>
        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
