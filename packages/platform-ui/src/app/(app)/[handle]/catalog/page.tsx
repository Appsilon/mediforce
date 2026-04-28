import { redirect } from 'next/navigation';

export default async function CatalogPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  redirect(`/${handle}/agents`);
}
