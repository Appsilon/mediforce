'use client';

import * as React from 'react';
import { GripHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Drag-and-drop slot for a workflow card in the catalog grid (native HTML5 DnD).
 * Only the grip starts a drag, so the card's links keep their own click/drag.
 */
export function SortableWorkflowCard({
  name,
  isDragged,
  isDropTarget,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
  children,
}: {
  name: string;
  isDragged: boolean;
  isDropTarget: boolean;
  onDragStart: (name: string) => void;
  onDragEnter: (name: string) => void;
  onDrop: (name: string) => void;
  onDragEnd: () => void;
  children: React.ReactNode;
}) {
  const cardRef = React.useRef<HTMLDivElement>(null);

  return (
    <div
      ref={cardRef}
      data-testid={`workflow-card-${name}`}
      className={cn(
        'group/sortable relative rounded-lg transition-opacity',
        isDragged === true && 'opacity-40',
        isDropTarget === true && isDragged === false && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
      onDragEnter={() => onDragEnter(name)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(name);
      }}
    >
      <div
        draggable={true}
        role="button"
        aria-label={`Drag to reorder ${name}`}
        title="Drag to reorder"
        data-testid={`workflow-card-handle-${name}`}
        className={cn(
          'absolute left-1/2 top-0.5 z-10 -translate-x-1/2 cursor-grab rounded px-1.5 text-muted-foreground active:cursor-grabbing',
          'opacity-0 transition-opacity hover:bg-muted group-hover/sortable:opacity-100 focus-visible:opacity-100',
        )}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', name);
          if (cardRef.current !== null) event.dataTransfer.setDragImage(cardRef.current, 24, 24);
          onDragStart(name);
        }}
        onDragEnd={onDragEnd}
      >
        <GripHorizontal className="h-3.5 w-3.5" />
      </div>
      {children}
    </div>
  );
}
