'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, Database, AlertTriangle, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTotalIssueCounts } from '@/lib/demo-data';

const issueCounts = getTotalIssueCounts();

const navItems = [
  {
    label: 'Requirements',
    href: '/requirements',
    icon: FileText,
    badge: null,
  },
  {
    label: 'Study Data',
    href: '/study-data',
    icon: Database,
    badge: null,
  },
  {
    label: 'Validation Issues',
    href: '/validation-issues',
    icon: AlertTriangle,
    badge: issueCounts.total,
  },
  {
    label: 'Validation Rules',
    href: '/validation-rules',
    icon: Shield,
    badge: null,
  },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 px-3">
      {navItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.badge !== null && item.badge > 0 && (
              <span
                className={cn(
                  'flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-semibold',
                  isActive
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : 'bg-destructive text-destructive-foreground'
                )}
              >
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
