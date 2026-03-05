import { NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';

export async function GET(): Promise<NextResponse> {
  const { pluginRegistry } = getPlatformServices();
  const plugins = pluginRegistry.list();
  return NextResponse.json({ plugins });
}
