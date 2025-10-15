// Database helper functions for Centralized Multi-Platform Schema
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// Initialize Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Get or create a user in the centralized users table
 */
export async function getOrCreateUser(platformUserId: string, userData?: any): Promise<any | null> {
  try {
    const platform = 'slack'; // Default to slack for now
    
    // Try to find existing user
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('platform', platform)
      .eq('platform_user_id', platformUserId)
      .single();

    if (existingUser) {
      // Update user info if provided
      if (userData) {
        const { data: updatedUser, error: updateError } = await supabase
          .from('users')
          .update({
            display_name: userData.display_name,
            username: userData.display_name,
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            platform_metadata: {
              ...existingUser.platform_metadata,
              slack_user_id: platformUserId,
              last_updated: new Date().toISOString()
            }
          })
          .eq('platform', platform)
          .eq('platform_user_id', platformUserId)
          .select()
          .single();

        if (updateError) {
          console.error('Error updating user:', updateError);
          return existingUser;
        }
        return updatedUser;
      }
      return existingUser;
    }

    // Create new user
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .upsert([{
        platform: platform,
        platform_user_id: platformUserId,
        username: userData?.display_name || platformUserId,
        display_name: userData?.display_name || 'Unknown User',
        language_code: 'en',
        is_bot: false,
        is_active: true,
        notifications_enabled: true,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        platform_metadata: {
          slack_user_id: platformUserId,
          team_id: userData?.team_id || 'unknown',
          created_via: 'slack_events'
        }
      }], {
        onConflict: 'platform,platform_user_id'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating user:', insertError);
      return null;
    }

    return newUser;
  } catch (error) {
    console.error('Error in getOrCreateUser:', error);
    return null;
  }
}

/**
 * Get or create a conversation in the centralized schema
 */
export async function getOrCreateConversation(
  userId: string,
  slackChannelId: string,
  slackThreadTs?: string
): Promise<any | null> {
  try {
    console.log(`🔍 Looking for conversation - User: ${userId}, Channel: ${slackChannelId}, Thread: ${slackThreadTs || 'none'}`);
    
    // Look for existing conversation
    const query = supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .eq('channel_id', slackChannelId)
      .eq('platform', 'slack');

    if (slackThreadTs) {
      query.eq('thread_id', slackThreadTs);
    } else {
      query.is('thread_id', null);
    }

    const { data: conversations } = await query.order('created_at', { ascending: false });
    
    if (conversations && conversations.length > 0) {
      const existingConversation = conversations[0];
      console.log(`🔄 Continuing existing conversation ID: ${existingConversation.id}`);
      return existingConversation;
    }

    // Create new conversation
    const { data: newConversation, error: insertError } = await supabase
      .from('conversations')
      .insert({
        platform: 'slack',
        user_id: userId,
        channel_id: slackChannelId,
        channel_name: null, // Can be updated later with channel info
        thread_id: slackThreadTs || null,
        is_group_chat: slackChannelId.startsWith('C'), // Channel vs DM detection
        is_dm: slackChannelId.startsWith('D'),
        status: 'active',
        last_activity_at: new Date().toISOString(),
        message_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        platform_metadata: {
          slack_channel_id: slackChannelId,
          slack_thread_ts: slackThreadTs,
          created_via: 'slack_events'
        }
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating conversation:', insertError);
      return null;
    }

    console.log(`✅ Created new conversation ID: ${newConversation.id}`);
    return newConversation;
  } catch (error) {
    console.error('Error in getOrCreateConversation:', error);
    return null;
  }
}

/**
 * Save user query to centralized user_queries table
 */
export async function saveUserQuery(
  conversationId: string,
  userId: string,
  content: string,
  slackMessageTs?: string
): Promise<any | null> {
  try {
    const { data: query, error } = await supabase
      .from('user_queries')
      .insert({
        conversation_id: conversationId,
        user_id: userId,
        content: content,
        platform_message_id: slackMessageTs,
        has_attachments: false,
        message_type: 'text',
        status: 'sent',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        platform_metadata: {
          slack_message_ts: slackMessageTs,
          created_via: 'slack_events'
        }
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving user query:', error);
      return null;
    }

    console.log(`✅ Saved user query ID: ${query.id}`);
    return query;
  } catch (error) {
    console.error('Error in saveUserQuery:', error);
    return null;
  }
}

/**
 * Save bot response to centralized bot_responses table
 */
export async function saveBotResponse(
  queryId: string,
  conversationId: string,
  content: string,
  modelUsed: string = 'gemini-2.0-flash',
  tokensUsed?: number,
  processingTimeMs?: number,
  slackMessageTs?: string,
  errorMessage?: string
): Promise<any | null> {
  try {
    const { data: response, error } = await supabase
      .from('bot_responses')
      .insert({
        query_id: queryId,
        conversation_id: conversationId,
        content: content,
        platform_message_id: slackMessageTs,
        model_used: modelUsed,
        tokens_used: tokensUsed,
        processing_time_ms: processingTimeMs,
        error_message: errorMessage,
        error_code: errorMessage ? 'AI_GENERATION_ERROR' : null,
        has_attachments: false,
        response_type: 'text',
        retry_count: 0,
        status: errorMessage ? 'failed' : 'sent',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        platform_metadata: {
          slack_message_ts: slackMessageTs,
          created_via: 'slack_events',
          had_error: !!errorMessage
        }
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving bot response:', error);
      return null;
    }

    console.log(`✅ Saved bot response ID: ${response.id}`);
    return response;
  } catch (error) {
    console.error('Error in saveBotResponse:', error);
    return null;
  }
}

/**
 * Update bot response with Slack message timestamp
 */
export async function updateBotResponseTimestamp(responseId: string, slackMessageTs: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('bot_responses')
      .update({
        platform_message_id: slackMessageTs,
        updated_at: new Date().toISOString(),
        platform_metadata: supabase.rpc('jsonb_set', {
          target: 'platform_metadata',
          path: '{slack_message_ts}',
          new_value: JSON.stringify(slackMessageTs)
        })
      })
      .eq('id', responseId);

    if (error) {
      console.error('Error updating bot response timestamp:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in updateBotResponseTimestamp:', error);
    return false;
  }
}

/**
 * Find bot response by Slack timestamp
 */
export async function findBotResponseByTimestamp(slackMessageTs: string): Promise<any | null> {
  try {
    const { data: response, error } = await supabase
      .from('bot_responses')
      .select('*')
      .eq('platform_message_id', slackMessageTs)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error finding bot response:', error);
      return null;
    }

    return response;
  } catch (error) {
    console.error('Error in findBotResponseByTimestamp:', error);
    return null;
  }
}

/**
 * Add message reaction in centralized schema
 */
export async function addMessageReaction(
  responseId: string,
  slackUserId: string,
  reactionName: string
): Promise<boolean> {
  try {
    // First, get the user ID from platform_user_id
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('platform', 'slack')
      .eq('platform_user_id', slackUserId)
      .single();

    if (!user) {
      console.error('User not found for reaction:', slackUserId);
      return false;
    }

    // Add reaction
    const { error } = await supabase
      .from('message_reactions')
      .upsert([{
        response_id: responseId,
        user_id: user.id,
        reaction_name: reactionName,
        reaction_unicode: getReactionUnicode(reactionName),
        platform: 'slack',
        created_at: new Date().toISOString()
      }], {
        onConflict: 'response_id,user_id,reaction_name'
      });

    if (error) {
      console.error('Error adding reaction:', error);
      return false;
    }

    console.log(`✅ Added reaction ${reactionName} from user ${slackUserId}`);
    return true;
  } catch (error) {
    console.error('Error in addMessageReaction:', error);
    return false;
  }
}

/**
 * Remove message reaction in centralized schema
 */
export async function removeMessageReaction(
  responseId: string,
  slackUserId: string,
  reactionName: string
): Promise<boolean> {
  try {
    // First, get the user ID from platform_user_id
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('platform', 'slack')
      .eq('platform_user_id', slackUserId)
      .single();

    if (!user) {
      console.error('User not found for reaction removal:', slackUserId);
      return false;
    }

    // Remove reaction (or mark as removed)
    const { error } = await supabase
      .from('message_reactions')
      .update({
        removed_at: new Date().toISOString()
      })
      .eq('response_id', responseId)
      .eq('user_id', user.id)
      .eq('reaction_name', reactionName);

    if (error) {
      console.error('Error removing reaction:', error);
      return false;
    }

    console.log(`✅ Removed reaction ${reactionName} from user ${slackUserId}`);
    return true;
  } catch (error) {
    console.error('Error in removeMessageReaction:', error);
    return false;
  }
}

/**
 * Update conversation activity and message count
 */
export async function updateConversationActivity(conversationId: string): Promise<void> {
  try {
    // Get message counts
    const { data: queryCount } = await supabase
      .from('user_queries')
      .select('id', { count: 'exact' })
      .eq('conversation_id', conversationId);

    const { data: responseCount } = await supabase
      .from('bot_responses')
      .select('id', { count: 'exact' })
      .eq('conversation_id', conversationId);

    const totalMessages = (queryCount?.length || 0) + (responseCount?.length || 0);

    // Update conversation
    await supabase
      .from('conversations')
      .update({
        message_count: totalMessages,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId);

  } catch (error) {
    console.error('Error updating conversation activity:', error);
  }
}

/**
 * Helper function to get unicode emoji from reaction name
 */
function getReactionUnicode(reactionName: string): string | null {
  const emojiMap: { [key: string]: string } = {
    'thumbsup': '👍',
    'thumbsdown': '👎',
    'heart': '❤️',
    'fire': '🔥',
    'eyes': '👀',
    'rocket': '🚀',
    'tada': '🎉',
    'thinking_face': '🤔',
    'confused': '😕',
    'smile': '😊',
    'joy': '😂',
    'sob': '😭',
    'angry': '😠',
    'clap': '👏',
    'raised_hands': '🙌'
  };

  return emojiMap[reactionName] || null;
}

/**
 * Check if user is muted (compatibility function)
 */
export async function isUserMuted(slackUserId: string): Promise<boolean> {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('platform_metadata')
      .eq('platform', 'slack')
      .eq('platform_user_id', slackUserId)
      .single();

    if (!user) return false;

    const metadata = user.platform_metadata as any;
    return metadata?.is_muted === true;
  } catch (error) {
    console.error('Error checking if user is muted:', error);
    return false;
  }
}