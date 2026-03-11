'use client';

import * as React from 'react';
import { Upload, X, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileUploadZoneProps {
  acceptedTypes: string[];
  minFiles: number;
  maxFiles: number;
  onSubmit: (files: File[]) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function mimeToLabel(mime: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'PDF',
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
    'text/csv': 'CSV',
    'application/octet-stream': 'Binary files (XPT, SAS, etc.)',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  };
  return map[mime] ?? mime;
}

export function FileUploadZone({
  acceptedTypes,
  minFiles,
  maxFiles,
  onSubmit,
}: FileUploadZoneProps) {
  const [files, setFiles] = React.useState<File[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const typeLabels = acceptedTypes.map(mimeToLabel).join(', ');

  function addFiles(incoming: FileList | File[]) {
    setError(null);
    const newFiles = Array.from(incoming);

    // Validate MIME types.
    // When application/octet-stream is accepted, also allow files with empty type
    // (browsers often leave .xpt, .sas7bdat, etc. untyped) and common data formats.
    const acceptsOctetStream = acceptedTypes.includes('application/octet-stream');
    const invalid = newFiles.filter((file) => {
      if (acceptedTypes.includes(file.type)) return false;
      if (acceptsOctetStream && (file.type === '' || file.type === 'application/json')) return false;
      return true;
    });
    if (invalid.length > 0) {
      const names = invalid.map((file) => file.name).join(', ');
      setError(`File type not accepted: ${names}. Accepted: ${typeLabels}`);
      return;
    }

    // Validate max count
    const total = files.length + newFiles.length;
    if (total > maxFiles) {
      setError(`Maximum ${maxFiles} files allowed`);
      return;
    }

    setFiles((previous) => [...previous, ...newFiles]);
  }

  function removeFile(index: number) {
    setFiles((previous) => previous.filter((_, idx) => idx !== index));
    setError(null);
  }

  function handleSubmit() {
    setError(null);
    if (files.length < minFiles) {
      setError(`At least ${minFiles} file${minFiles > 1 ? 's' : ''} required`);
      return;
    }
    onSubmit(files);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files.length > 0) {
      addFiles(event.dataTransfer.files);
    }
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files && event.target.files.length > 0) {
      addFiles(event.target.files);
    }
    // Reset input so the same file can be re-selected
    event.target.value = '';
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors',
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50',
        )}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Drop files here or click to browse
        </p>
        <p className="text-xs text-muted-foreground/70">
          {typeLabels} — {minFiles} to {maxFiles} files
        </p>
        <input
          ref={inputRef}
          type="file"
          data-testid="file-input"
          multiple
          accept={acceptedTypes.join(',')}
          onChange={handleInputChange}
          className="hidden"
        />
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* File list */}
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center justify-between rounded-md border px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm truncate">{file.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatFileSize(file.size)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeFile(index)}
                aria-label="Remove file"
                className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Submit */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={files.length === 0}
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
          'bg-primary text-primary-foreground hover:bg-primary/90',
          files.length === 0 && 'opacity-50 cursor-not-allowed',
        )}
      >
        <Upload className="h-4 w-4" />
        Upload {files.length > 0 ? `(${files.length})` : ''}
      </button>
    </div>
  );
}
