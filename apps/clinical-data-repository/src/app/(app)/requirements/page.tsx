'use client';

import { useState } from 'react';
import { LayoutGrid, List, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RequirementFileCard } from '@/components/file-card';
import { RequirementFileTable } from '@/components/file-table';
import { requirementFiles } from '@/lib/demo-data';
import type { RequirementFile } from '@/lib/types';

export default function RequirementsPage() {
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [files, setFiles] = useState<RequirementFile[]>(requirementFiles);

  function handleSimulatedUpload() {
    const newFile: RequirementFile = {
      id: `req-upload-${Date.now()}`,
      name: `Uploaded_Document_${files.length + 1}.pdf`,
      type: 'Protocol',
      sizeBytes: Math.floor(Math.random() * 2000000) + 100000,
      uploadedAt: new Date().toISOString(),
      aiSummary:
        'AI summary pending — document is being processed. This will be updated shortly with key findings and annotations.',
      contentType: 'pdf',
    };
    setFiles((prev) => [newFile, ...prev]);
  }

  return (
    <div className="p-6 space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {files.length} document{files.length !== 1 ? 's' : ''} · Protocol, DTS, CRF specs, SAP
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
            <RequirementFileCard key={file.id} file={file} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border bg-card">
          <RequirementFileTable files={files} />
        </div>
      )}
    </div>
  );
}
