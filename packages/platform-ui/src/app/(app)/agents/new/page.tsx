import Link from 'next/link';
import { Bot, ArrowLeft } from 'lucide-react';

export default function NewAgentPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-8 w-8 text-primary" />
      </div>
      <div className="space-y-2">
        <h1 className="text-xl font-headline font-semibold">Add New Agent</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Agent creation is coming soon. You will be able to register new agent plugins,
          configure their autonomy levels, and assign them to workflow steps.
        </p>
      </div>
      <Link
        href="/agents"
        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Agents
      </Link>
    </div>
  );
}
