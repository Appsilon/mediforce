'use client';

import { AlertTriangle, XCircle } from 'lucide-react';

interface ConfigValidationBannerProps {
  errors: string[];
  warnings: string[];
}

export function ConfigValidationBanner({
  errors,
  warnings,
}: ConfigValidationBannerProps) {
  if (errors.length === 0 && warnings.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {errors.length > 0 && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-destructive mb-1">
            <XCircle className="h-4 w-4" />
            {errors.length} Error{errors.length !== 1 ? 's' : ''}
          </div>
          <ul className="space-y-0.5">
            {errors.map((error, i) => (
              <li key={i} className="text-sm text-destructive/90 pl-5">
                {error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400 mb-1">
            <AlertTriangle className="h-4 w-4" />
            {warnings.length} Warning{warnings.length !== 1 ? 's' : ''}
          </div>
          <ul className="space-y-0.5">
            {warnings.map((warning, i) => (
              <li
                key={i}
                className="text-sm text-amber-700/90 dark:text-amber-400/90 pl-5"
              >
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
