import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    mockAgent: process.env.MOCK_AGENT === 'true',
    timestamp: new Date().toISOString(),
  });
}
