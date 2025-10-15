import { NextRequest, NextResponse } from 'next/server';
import { getUserStats } from '@/lib/database';

/**
 * GET /api/analytics/user-stats?slackUserId=U12345
 * Get statistics for a specific user
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const slackUserId = searchParams.get('slackUserId');

    if (!slackUserId) {
      return NextResponse.json(
        { error: 'Missing slackUserId parameter' },
        { status: 400 }
      );
    }

    // First, get the user ID from slack_user_id
    const { supabase } = await import('@/lib/supabaseClient');
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('slack_user_id', slackUserId)
      .single();

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const stats = await getUserStats((user as any).id);

    return NextResponse.json({
      slackUserId,
      stats
    });
  } catch (error: any) {
    console.error('Error fetching user stats:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
