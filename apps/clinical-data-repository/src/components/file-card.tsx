'use client';

import Link from 'next/link';
import { FileText, FileSpreadsheet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { formatFileSize, formatDate } from '@/lib/utils';
import type { RequirementFile, StudyFile } from '@/lib/types';

function getFileIcon(contentType: string) {
  if (contentType === 'xlsx' || contentType === 'csv' || contentType === 'xpt') {
    return FileSpreadsheet;
  }
  return FileText;
}

interface RequirementFileCardProps {
  file: RequirementFile;
}

export function RequirementFileCard({ file }: RequirementFileCardProps) {
  const Icon = getFileIcon(file.contentType);
  return (
    <Link href={`/file-viewer/${file.id}`}>
      <Card className="h-full cursor-pointer transition-shadow hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5 shrink-0 text-primary" />
              <CardTitle className="text-sm leading-snug">{file.name}</CardTitle>
            </div>
            <Badge variant="secondary" className="shrink-0 text-xs">
              {file.type}
            </Badge>
          </div>
          <CardDescription className="text-xs">
            {formatFileSize(file.sizeBytes)} · Uploaded {formatDate(file.uploadedAt)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
            {file.aiSummary}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

interface StudyFileCardProps {
  file: StudyFile;
}

export function StudyFileCard({ file }: StudyFileCardProps) {
  const Icon = getFileIcon(file.contentType);
  return (
    <Link href={`/file-viewer/${file.id}`}>
      <Card className="h-full cursor-pointer transition-shadow hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5 shrink-0 text-primary" />
              <CardTitle className="text-sm leading-snug">{file.name}</CardTitle>
            </div>
            <Badge variant="outline" className="shrink-0 text-xs">
              {file.domain}
            </Badge>
          </div>
          <CardDescription className="text-xs">
            {formatFileSize(file.sizeBytes)} · Uploaded {formatDate(file.uploadedAt)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {file.hasIssues ? (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-md p-2 border border-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Data contains {file.issueCount} issue{file.issueCount !== 1 ? 's' : ''} — click to see details
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-md p-2 border border-green-200">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>No validation issues found</span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
