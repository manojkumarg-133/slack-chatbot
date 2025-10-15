// Test Edge Function - Simple response to debug the issue
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async (req) => {
  console.log('🧪 Test function called');
  
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.text();
    console.log('📦 Received body length:', body.length);
    
    const data = JSON.parse(body);
    console.log('📨 Event type:', data.event?.type);
    console.log('👤 User:', data.event?.user);
    
    // Just respond OK for now
    return new Response('OK', { status: 200 });
    
  } catch (error) {
    console.error('❌ Test error:', error);
    return new Response('Error', { status: 500 });
  }
});