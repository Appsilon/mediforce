'use client';

import * as React from 'react';
import * as Toast from '@radix-ui/react-toast';
import { CheckCircle2, AlertCircle, Info, X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToastOpts, ToastVariant } from './types';

type ToastItem = ToastOpts & { id: number };

type ToastContextValue = {
  toast: (opts: ToastOpts) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (ctx === null) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const toast = React.useCallback((opts: ToastOpts) => {
    const id = nextId++;
    setItems((prev) => [...prev, { ...opts, id }]);
  }, []);

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <Toast.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((item) => (
          <ToastEntry
            key={item.id}
            item={item}
            onDismissed={() => setItems((prev) => prev.filter((existing) => existing.id !== item.id))}
          />
        ))}
        <Toast.Viewport
          className="fixed bottom-4 right-4 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none"
          data-testid="toast-viewport"
        />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}

const VARIANT_ICON: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const VARIANT_ACCENT: Record<ToastVariant, string> = {
  success: 'text-green-600 dark:text-green-400',
  error: 'text-destructive',
  info: 'text-muted-foreground',
};

function ToastEntry({ item, onDismissed }: { item: ToastItem; onDismissed: () => void }) {
  const variant: ToastVariant = item.variant ?? 'info';
  const Icon = VARIANT_ICON[variant];

  return (
    <Toast.Root
      onOpenChange={(open) => {
        if (!open) onDismissed();
      }}
      className={cn(
        'group pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-md border bg-background p-3 pr-8 shadow-lg',
        'data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full',
        'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right-full',
      )}
      data-testid="toast"
    >
      <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', VARIANT_ACCENT[variant])} />
      <div className="flex-1 min-w-0">
        <Toast.Title className="text-sm font-medium text-foreground">{item.title}</Toast.Title>
        {typeof item.description === 'string' && item.description !== '' && (
          <Toast.Description className="mt-1 text-xs text-muted-foreground break-words">
            {item.description}
          </Toast.Description>
        )}
        {item.action !== undefined && (
          <Toast.Action
            asChild
            altText={item.action.label}
          >
            <a
              href={item.action.href}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {item.action.label}
              <ExternalLink className="h-3 w-3" />
            </a>
          </Toast.Action>
        )}
      </div>
      <Toast.Close
        className="absolute right-2 top-2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </Toast.Close>
    </Toast.Root>
  );
}
