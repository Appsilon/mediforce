import { redirect } from 'next/navigation';

export default async function WorkflowsIndexPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  redirect(`/${handle}`);
}
