'use client';

import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataGrid } from '@/components/data-grid';
import { QuerySidebar } from '@/components/query-sidebar';
import { getFileById, getValidationIssuesForFile } from '@/lib/demo-data';
import { rowsToHeaders } from '@/lib/csv-parser';
import { formatFileSize, formatDate } from '@/lib/utils';
import type { QueryItem } from '@/lib/types';

function generateId(): string {
  return `qi-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function FileViewerPage() {
  const params = useParams();
  const router = useRouter();
  const fileId = typeof params.fileId === 'string' ? params.fileId : params.fileId?.[0] ?? '';

  const file = getFileById(fileId);
  const validationIssues = useMemo(
    () => getValidationIssuesForFile(fileId),
    [fileId]
  );

  const [queryItems, setQueryItems] = useState<QueryItem[]>([]);

  if (file === undefined) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">File not found.</p>
        <Button variant="outline" onClick={() => router.back()}>
          Go Back
        </Button>
      </div>
    );
  }

  const isStudyFile = 'domain' in file;
  const hasIssues = isStudyFile && file.hasIssues;
  const issueCount = isStudyFile ? file.issueCount : 0;
  const rows = 'rows' in file && Array.isArray(file.rows) ? file.rows : [];
  const headers = rowsToHeaders(rows);

  function handleAddQueryItem(item: Omit<QueryItem, 'id' | 'createdAt'>) {
    const newItem: QueryItem = {
      ...item,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    setQueryItems((prev) => [...prev, newItem]);
  }

  function handleRemoveQueryItem(itemId: string) {
    setQueryItems((prev) => prev.filter((item) => item.id !== itemId));
  }

  const canShowGrid =
    (file.contentType === 'csv' || file.contentType === 'xlsx' || file.contentType === 'xpt') &&
    rows.length > 0;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* File header */}
        <div className="flex items-center gap-4 border-b bg-card px-6 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm truncate">{file.name}</span>
              {'type' in file && (
                <Badge variant="secondary" className="text-xs shrink-0">
                  {file.type}
                </Badge>
              )}
              {'domain' in file && (
                <Badge variant="outline" className="text-xs shrink-0">
                  {file.domain}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {formatFileSize(file.sizeBytes)} · {formatDate(file.uploadedAt)}
              </span>
            </div>
          </div>
          {hasIssues && (
            <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 shrink-0">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{issueCount} validation issue{issueCount !== 1 ? 's' : ''}</span>
            </div>
          )}
          {isStudyFile && !hasIssues && (
            <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-2 py-1 shrink-0">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>No issues</span>
            </div>
          )}
        </div>

        {/* File content */}
        <div className="flex-1 overflow-auto p-6">
          {canShowGrid && (
            <div className="space-y-4">
              {validationIssues.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-800 font-medium mb-1.5">
                    Validation Issues in this file:
                  </p>
                  <ul className="space-y-1">
                    {validationIssues.slice(0, 5).map((issue) => (
                      <li key={issue.id} className="text-xs text-amber-700 flex gap-2">
                        <span
                          className={
                            issue.severity === 'Error'
                              ? 'text-destructive font-medium'
                              : issue.severity === 'Warning'
                              ? 'text-yellow-700 font-medium'
                              : 'text-blue-700 font-medium'
                          }
                        >
                          [{issue.severity}]
                        </span>
                        <span>Row {issue.row}, {issue.variable}: {issue.description}</span>
                      </li>
                    ))}
                    {validationIssues.length > 5 && (
                      <li className="text-xs text-amber-600">
                        +{validationIssues.length - 5} more issues — see Validation Issues page
                      </li>
                    )}
                  </ul>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  {rows.length} rows · {headers.length} columns · Right-click any cell to add a comment
                </p>
                <DataGrid
                  headers={headers}
                  rows={rows}
                  validationIssues={validationIssues}
                  onAddQueryItem={handleAddQueryItem}
                />
              </div>
            </div>
          )}

          {file.contentType === 'pdf' && (
            <div className="flex flex-col items-center justify-center h-64 gap-4 rounded-lg border-2 border-dashed border-border">
              <FileText className="h-12 w-12 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">PDF Preview</p>
                <p className="text-xs text-muted-foreground mt-1">
                  PDF rendering is not available in this demo environment.
                  <br />
                  In production, the document would be rendered inline.
                </p>
              </div>
            </div>
          )}

          {(file.contentType === 'txt' || file.contentType === 'xml') && (
            <pre className="rounded-lg border bg-card p-4 text-xs font-mono overflow-auto whitespace-pre-wrap">
              {`[${file.contentType.toUpperCase()} content preview]\n\nFile: ${file.name}\nSize: ${formatFileSize(file.sizeBytes)}\n\nIn production, raw file content would be displayed here.`}
            </pre>
          )}

          {(file.contentType === 'xlsx' ||
            file.contentType === 'xpt') &&
            rows.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 gap-4 rounded-lg border-2 border-dashed border-border">
              <FileText className="h-12 w-12 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">
                  {file.contentType.toUpperCase()} File
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Binary file format — data preview not available for this file type in demo mode.
                </p>
              </div>
            </div>
          )}

          {'aiSummary' in file && (
            <div className="mt-6 rounded-lg border bg-card p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                AI-Generated Summary
              </p>
              <p className="text-sm leading-relaxed">{file.aiSummary}</p>
            </div>
          )}
        </div>
      </div>

      {/* Query sidebar — only for CSV/data files */}
      {(canShowGrid || isStudyFile) && (
        <QuerySidebar
          fileId={fileId}
          queryItems={queryItems}
          onRemoveItem={handleRemoveQueryItem}
        />
      )}
    </div>
  );
}
