'use client';

import Link from 'next/link';
import { AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import { TableCell, TableRow } from './ui/table';
import { Badge } from './ui/badge';
import type { ValidationIssue, ValidationSeverity } from '@/lib/types';

function SeverityBadge({ severity }: { severity: ValidationSeverity }) {
  if (severity === 'Error') {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertOctagon className="h-3 w-3" />
        Error
      </Badge>
    );
  }
  if (severity === 'Warning') {
    return (
      <Badge variant="warning" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        Warning
      </Badge>
    );
  }
  return (
    <Badge variant="info" className="gap-1">
      <Info className="h-3 w-3" />
      Info
    </Badge>
  );
}

interface ValidationIssueRowProps {
  issue: ValidationIssue;
}

export function ValidationIssueRow({ issue }: ValidationIssueRowProps) {
  return (
    <TableRow>
      <TableCell>
        <SeverityBadge severity={issue.severity} />
      </TableCell>
      <TableCell>
        <Link
          href={`/file-viewer/${issue.fileId}`}
          className="text-sm text-primary hover:underline font-medium"
        >
          {issue.fileName}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="text-xs">
          {issue.domain}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-xs font-medium">{issue.variable}</TableCell>
      <TableCell className="text-sm text-muted-foreground text-center">{issue.row}</TableCell>
      <TableCell className="text-sm">{issue.description}</TableCell>
      {issue.cellValue !== undefined && issue.cellValue !== '' && (
        <TableCell>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
            {issue.cellValue}
          </code>
        </TableCell>
      )}
      {(issue.cellValue === undefined || issue.cellValue === '') && (
        <TableCell>
          <span className="text-xs text-muted-foreground italic">empty</span>
        </TableCell>
      )}
    </TableRow>
  );
}
