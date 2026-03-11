'use client';

import { useState, useEffect } from 'react';
import { Send, MessageSquare, Clock } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import type { QueryItem, SentQuery } from '@/lib/types';

interface QuerySidebarProps {
  fileId: string;
  queryItems: QueryItem[];
  onRemoveItem?: (itemId: string) => void;
}

function formatQueryMessage(items: QueryItem[]): string {
  if (items.length === 0) return '';
  const lines = [
    'Dear CRO Data Management Team,',
    '',
    'We have identified the following data queries in the submitted dataset. Please review and provide corrections or clarifications:',
    '',
  ];
  items.forEach((item, index) => {
    lines.push(`${index + 1}. Column ${item.column}, Row ${item.row}:`);
    lines.push(`   ${item.commentText}`);
    lines.push('');
  });
  lines.push('Please respond with corrected data or explanation at your earliest convenience.');
  lines.push('');
  lines.push('Best regards,');
  lines.push('Mediforce Clinical Data Management');
  return lines.join('\n');
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function QuerySidebar({ queryItems, onRemoveItem }: QuerySidebarProps) {
  const [queryText, setQueryText] = useState('');
  const [sentQueries, setSentQueries] = useState<SentQuery[]>([]);

  useEffect(() => {
    if (queryItems.length > 0) {
      setQueryText(formatQueryMessage(queryItems));
    } else {
      setQueryText('');
    }
  }, [queryItems]);

  function handleSend() {
    if (queryText.trim() === '') return;
    const newQuery: SentQuery = {
      id: `sq-${Date.now()}`,
      message: queryText.trim(),
      sentAt: new Date().toISOString(),
      fileId: '',
    };
    setSentQueries((prev) => [newQuery, ...prev]);
    setQueryText('');
    queryItems.forEach((item) => onRemoveItem?.(item.id));
  }

  return (
    <aside className="flex w-80 flex-col border-l bg-background">
      <div className="flex items-center gap-2 p-4 border-b">
        <MessageSquare className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Query to CRO</h2>
        {queryItems.length > 0 && (
          <Badge variant="secondary" className="ml-auto">
            {queryItems.length}
          </Badge>
        )}
      </div>

      {/* Query items list */}
      {queryItems.length > 0 && (
        <div className="border-b">
          <div className="px-4 py-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Pending Items
            </p>
          </div>
          <ScrollArea className="max-h-48">
            <div className="px-4 pb-3 space-y-2">
              {queryItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md border bg-muted/30 p-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-primary">
                      {item.column}, Row {item.row}
                    </span>
                    <button
                      className="text-muted-foreground hover:text-destructive transition-colors text-lg leading-none"
                      onClick={() => onRemoveItem?.(item.id)}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                  <p className="text-muted-foreground mt-1 leading-relaxed">{item.commentText}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Compose area */}
      <div className="flex flex-col gap-3 p-4 border-b">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
          Compose Query
        </p>
        <Textarea
          placeholder={
            queryItems.length === 0
              ? 'Right-click on a cell and select "Add comment for CRO" to start a query...'
              : 'Query message auto-populated from comments above...'
          }
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          className="min-h-[140px] text-xs resize-none"
        />
        <Button
          onClick={handleSend}
          disabled={queryText.trim() === ''}
          size="sm"
          className="w-full gap-2"
        >
          <Send className="h-3.5 w-3.5" />
          Send Query
        </Button>
      </div>

      {/* Sent queries history */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-4 py-2 border-b">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            Sent Queries
          </p>
        </div>
        {sentQueries.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-4">
            <p className="text-xs text-muted-foreground text-center">
              No queries sent yet
            </p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {sentQueries.map((query) => (
                <div key={query.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{formatTimestamp(query.sentAt)}</span>
                  </div>
                  <div className="rounded-lg bg-primary/10 border border-primary/20 px-3 py-2 text-xs whitespace-pre-wrap leading-relaxed">
                    {query.message}
                  </div>
                  <Separator className="mt-1" />
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </aside>
  );
}
