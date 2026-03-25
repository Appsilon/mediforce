import { redirect } from 'next/navigation';

export default async function ProcessesPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  redirect(`/${handle}`);
}
