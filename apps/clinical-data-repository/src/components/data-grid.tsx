'use client';

import React, { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { MessageSquare, Send } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from './ui/dialog';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { cn } from '@/lib/utils';
import type { ValidationIssue, QueryItem } from '@/lib/types';

interface CellPosition {
  column: string;
  row: number;
}

interface DataGridProps {
  headers: string[];
  rows: Record<string, string>[];
  validationIssues?: ValidationIssue[];
  onAddQueryItem?: (item: Omit<QueryItem, 'id' | 'createdAt'>) => void;
}

function getCellIssues(
  column: string,
  rowIndex: number,
  issues: ValidationIssue[]
): ValidationIssue[] {
  return issues.filter(
    (issue) => issue.variable === column && issue.row === rowIndex + 1
  );
}

export function DataGrid({ headers, rows, validationIssues = [], onAddQueryItem }: DataGridProps) {
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [contextMenuCell, setContextMenuCell] = useState<CellPosition | null>(null);
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [commentTarget, setCommentTarget] = useState<'ValidationAgent' | 'CRO'>('CRO');
  const [pendingCell, setPendingCell] = useState<CellPosition | null>(null);
  const [commentText, setCommentText] = useState('');

  const columnHelper = createColumnHelper<Record<string, string>>();

  const columns = [
    columnHelper.display({
      id: '_rownum',
      header: '#',
      cell: (info) => (
        <span className="text-muted-foreground text-xs select-none">{info.row.index + 1}</span>
      ),
      size: 48,
    }),
    ...headers.map((header) =>
      columnHelper.accessor(header, {
        header,
        cell: (info) => info.getValue(),
        size: Math.max(100, header.length * 9),
      })
    ),
  ];

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  function handleCellClick(event: React.MouseEvent, column: string, rowIndex: number) {
    event.preventDefault();
    setSelectedCell({ column, row: rowIndex });
  }

  function handleCellContextMenu(event: React.MouseEvent, column: string, rowIndex: number) {
    event.preventDefault();
    setContextMenuPos({ x: event.clientX, y: event.clientY });
    setContextMenuCell({ column, row: rowIndex });
  }

  function closeContextMenu() {
    setContextMenuPos(null);
    setContextMenuCell(null);
  }

  function openCommentDialog(target: 'ValidationAgent' | 'CRO') {
    if (contextMenuCell === null) return;
    setCommentTarget(target);
    setPendingCell(contextMenuCell);
    setCommentText('');
    closeContextMenu();
    setCommentDialogOpen(true);
  }

  function submitComment() {
    if (pendingCell === null || commentText.trim() === '') return;
    onAddQueryItem?.({
      column: pendingCell.column,
      row: pendingCell.row + 1,
      commentText: commentText.trim(),
      targetType: commentTarget,
    });
    setCommentDialogOpen(false);
    setCommentText('');
    setPendingCell(null);
  }

  return (
    <div
      className="relative"
      onClick={() => {
        closeContextMenu();
      }}
    >
      <div className="overflow-auto border rounded-md">
        <table className="text-xs border-collapse" style={{ minWidth: 'max-content' }}>
          <thead className="sticky top-0 z-10 bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="border-b border-r px-2 py-2 text-left font-semibold text-xs text-muted-foreground whitespace-nowrap bg-muted"
                    style={{ width: header.getSize(), minWidth: header.getSize() }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b hover:bg-muted/30 transition-colors"
              >
                {row.getVisibleCells().map((cell) => {
                  const isRowNum = cell.column.id === '_rownum';
                  const columnId = cell.column.id;
                  const rowIndex = row.index;

                  if (isRowNum) {
                    return (
                      <td
                        key={cell.id}
                        className="border-r px-2 py-1.5 text-center bg-muted/20 select-none"
                        style={{ width: 48, minWidth: 48 }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  }

                  const cellIssues = getCellIssues(columnId, rowIndex, validationIssues);
                  const hasError = cellIssues.some((i) => i.severity === 'Error');
                  const hasWarning = !hasError && cellIssues.some((i) => i.severity === 'Warning');
                  const isSelected =
                    selectedCell?.column === columnId && selectedCell?.row === rowIndex;

                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        'border-r px-2 py-1.5 cursor-pointer whitespace-nowrap transition-colors',
                        hasError && 'bg-red-50 text-red-900',
                        hasWarning && 'bg-yellow-50 text-yellow-900',
                        isSelected && 'ring-2 ring-inset ring-primary',
                        !hasError && !hasWarning && 'hover:bg-accent/10'
                      )}
                      style={{ width: cell.column.getSize(), minWidth: cell.column.getSize() }}
                      onClick={(e) => handleCellClick(e, columnId, rowIndex)}
                      onContextMenu={(e) => handleCellContextMenu(e, columnId, rowIndex)}
                      title={
                        cellIssues.length > 0
                          ? cellIssues.map((i) => i.description).join('\n')
                          : undefined
                      }
                    >
                      <span>{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Context menu */}
      {contextMenuPos !== null && contextMenuCell !== null && (
        <div
          className="fixed z-50 min-w-[200px] rounded-md border bg-popover p-1 shadow-md text-sm"
          style={{ top: contextMenuPos.y, left: contextMenuPos.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1.5 text-xs text-muted-foreground font-medium border-b mb-1">
            Column: {contextMenuCell.column} · Row {contextMenuCell.row + 1}
          </div>
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent/20 transition-colors text-left"
            onClick={() => openCommentDialog('ValidationAgent')}
          >
            <MessageSquare className="h-3.5 w-3.5 text-primary" />
            Add comment for Validation Agent
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent/20 transition-colors text-left"
            onClick={() => openCommentDialog('CRO')}
          >
            <Send className="h-3.5 w-3.5 text-amber-600" />
            Add comment for CRO
          </button>
        </div>
      )}

      {/* Comment dialog */}
      <Dialog open={commentDialogOpen} onOpenChange={setCommentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add Comment for {commentTarget === 'CRO' ? 'CRO' : 'Validation Agent'}
            </DialogTitle>
            <DialogDescription>
              {pendingCell !== null && (
                <>
                  Column <strong>{pendingCell.column}</strong>, Row{' '}
                  <strong>{pendingCell.row + 1}</strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="comment-text">Comment</Label>
              <Textarea
                id="comment-text"
                placeholder={
                  commentTarget === 'CRO'
                    ? 'Describe the data issue or question for the CRO...'
                    : 'Describe what the validation agent should check...'
                }
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                className="mt-1.5 min-h-[100px]"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommentDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitComment} disabled={commentText.trim() === ''}>
              Add Comment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
