'use client';

import { Sparkles, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface AiSummaryCardProps {
  narrative: string | null;
  generatedAt: string | null;
  loading: boolean;
  onReanalyze: () => void;
  reanalyzing: boolean;
}

export function AiSummaryCard({
  narrative,
  generatedAt,
  loading,
  onReanalyze,
  reanalyzing,
}: AiSummaryCardProps) {
  return (
    <Card data-testid="ai-summary-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
            AI Risk Summary
          </CardTitle>
          <div className="flex items-center gap-3">
            {generatedAt && !loading && (
              <span className="text-xs text-muted-foreground">
                Generated{' '}
                {formatDistanceToNow(new Date(generatedAt), {
                  addSuffix: true,
                })}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onReanalyze}
              disabled={reanalyzing}
            >
              <RefreshCw
                className={`h-4 w-4 mr-1 ${reanalyzing ? 'animate-spin' : ''}`}
              />
              Re-analyze
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading || reanalyzing ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : narrative ? (
          <p className="text-sm leading-relaxed">{narrative}</p>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            No analysis available yet. Click Re-analyze to generate.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
