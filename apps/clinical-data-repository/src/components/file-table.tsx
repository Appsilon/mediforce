'use client';

import Link from 'next/link';
import { FileText, FileSpreadsheet, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { Badge } from './ui/badge';
import { formatFileSize, formatDate } from '@/lib/utils';
import type { RequirementFile, StudyFile } from '@/lib/types';

function getFileIcon(contentType: string) {
  if (contentType === 'xlsx' || contentType === 'csv' || contentType === 'xpt') {
    return FileSpreadsheet;
  }
  return FileText;
}

interface RequirementFileTableProps {
  files: RequirementFile[];
}

export function RequirementFileTable({ files }: RequirementFileTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Uploaded</TableHead>
          <TableHead className="max-w-xs">AI Summary</TableHead>
          <TableHead className="w-10"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => {
          const Icon = getFileIcon(file.contentType);
          return (
            <TableRow key={file.id} className="cursor-pointer">
              <TableCell>
                <Link
                  href={`/file-viewer/${file.id}`}
                  className="flex items-center gap-2 hover:text-primary"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium text-sm">{file.name}</span>
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{file.type}</Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatFileSize(file.sizeBytes)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(file.uploadedAt)}
              </TableCell>
              <TableCell className="max-w-xs">
                <p className="text-xs text-muted-foreground truncate">{file.aiSummary}</p>
              </TableCell>
              <TableCell>
                <Link href={`/file-viewer/${file.id}`}>
                  <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Link>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

interface StudyFileTableProps {
  files: StudyFile[];
}

export function StudyFileTable({ files }: StudyFileTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File Name</TableHead>
          <TableHead>Domain</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Uploaded</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-10"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => {
          const Icon = getFileIcon(file.contentType);
          return (
            <TableRow key={file.id} className="cursor-pointer">
              <TableCell>
                <Link
                  href={`/file-viewer/${file.id}`}
                  className="flex items-center gap-2 hover:text-primary"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium text-sm">{file.name}</span>
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{file.domain}</Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatFileSize(file.sizeBytes)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(file.uploadedAt)}
              </TableCell>
              <TableCell>
                {file.hasIssues ? (
                  <div className="flex items-center gap-1.5 text-xs text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>{file.issueCount} issue{file.issueCount !== 1 ? 's' : ''}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Clean</span>
                  </div>
                )}
              </TableCell>
              <TableCell>
                <Link href={`/file-viewer/${file.id}`}>
                  <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Link>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
