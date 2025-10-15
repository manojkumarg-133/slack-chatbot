import { NextRequest, NextResponse } from 'next/server';

/**
 * Simple test endpoint to verify the API is responding
 * Test with: curl http://localhost:3000/api/test
 */
export async function GET(req: NextRequest) {
  return NextResponse.json({
    status: 'ok',
    message: 'API is working!',
    timestamp: new Date().toISOString()
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  
  return NextResponse.json({
    status: 'ok',
    message: 'POST received',
    received: body,
    timestamp: new Date().toISOString()
  });
}
