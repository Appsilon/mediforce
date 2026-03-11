'use client';

import { useState } from 'react';
import { LayoutGrid, List, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StudyFileCard } from '@/components/file-card';
import { StudyFileTable } from '@/components/file-table';
import { studyFiles } from '@/lib/demo-data';
import type { StudyFile } from '@/lib/types';

export default function StudyDataPage() {
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [files, setFiles] = useState<StudyFile[]>(studyFiles);

  const issueCount = files.filter((f) => f.hasIssues).length;
  const cleanCount = files.filter((f) => !f.hasIssues).length;

  function handleSimulatedUpload() {
    const domains = ['DM', 'AE', 'LB', 'VS', 'EX', 'CM'] as const;
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const newFile: StudyFile = {
      id: `study-upload-${Date.now()}`,
      name: `${domain}_2025Q1.csv`,
      domain,
      sizeBytes: Math.floor(Math.random() * 100000) + 10000,
      uploadedAt: new Date().toISOString(),
      hasIssues: false,
      issueCount: 0,
      contentType: 'csv',
      rows: [],
    };
    setFiles((prev) => [newFile, ...prev]);
  }

  return (
    <div className="p-6 space-y-6">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-4">
        <div className="rounded-lg border bg-card p-3 flex items-center gap-3 min-w-[140px]">
          <div className="text-2xl font-bold font-headline text-foreground">{files.length}</div>
          <div className="text-xs text-muted-foreground">Total files</div>
        </div>
        <div className="rounded-lg border bg-card p-3 flex items-center gap-3 min-w-[140px]">
          <div className="text-2xl font-bold font-headline text-amber-600">{issueCount}</div>
          <div className="text-xs text-muted-foreground">Files with issues</div>
        </div>
        <div className="rounded-lg border bg-card p-3 flex items-center gap-3 min-w-[140px]">
          <div className="text-2xl font-bold font-headline text-green-600">{cleanCount}</div>
          <div className="text-xs text-muted-foreground">Clean files</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {files.length} SDTM domain file{files.length !== 1 ? 's' : ''} · Q4 2024
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border bg-background p-1">
            <button
              className={`rounded px-2 py-1 text-xs transition-colors ${
                viewMode === 'card'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setViewMode('card')}
              title="Card view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              className={`rounded px-2 py-1 text-xs transition-colors ${
                viewMode === 'table'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setViewMode('table')}
              title="Table view"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button size="sm" className="gap-2" onClick={handleSimulatedUpload}>
            <Upload className="h-3.5 w-3.5" />
            Upload File
          </Button>
        </div>
      </div>

      {/* Content */}
      {viewMode === 'card' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((file) => (
            <StudyFileCard key={file.id} file={file} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border bg-card">
          <StudyFileTable files={files} />
        </div>
      )}
    </div>
  );
}
