// Database helper functions for Supabase Edge Functions
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// Initialize Supabase client
// Use the built-in Supabase environment variables (auto-created)
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Get or create a user in the centralized database
 */
export async function getOrCreateUser(slackUserId: string, userData?: any): Promise<any | null> {
  try {
    const platform = 'slack';
    const platformUserId = slackUserId;
    
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
        const updateData = {
          display_name: userData.display_name,
          username: userData.username,
          email: userData.email,
          avatar_url: userData.avatar_url,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          platform_metadata: {
            ...existingUser.platform_metadata,
            slack_team_id: userData.slack_team_id,
            last_updated: new Date().toISOString()
          }
        };

        const { data: updatedUser, error: updateError } = await supabase
          .from('users')
          .update(updateData)
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

    // Create new user for centralized schema
    const newUserData = {
      platform: platform as any,
      platform_user_id: platformUserId,
      username: userData?.username || slackUserId,
      display_name: userData?.display_name || 'Unknown User',
      email: userData?.email,
      avatar_url: userData?.avatar_url,
      language_code: 'en',
      is_bot: false,
      is_active: true,
      notifications_enabled: true,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      platform_metadata: {
        slack_user_id: slackUserId,
        slack_team_id: userData?.slack_team_id,
        created_from: 'slack_bot',
        created_at: new Date().toISOString()
      }
    };

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([newUserData])
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
 * Get or create a conversation in centralized database
 */
export async function getOrCreateConversation(
  userId: string,
  slackChannelId: string,
  slackThreadTs?: string
): Promise<any | null> {
  try {
    console.log(`🔍 Looking for conversation - User: ${userId}, Channel: ${slackChannelId}, Thread: ${slackThreadTs || 'none'}`);
    
    // For better conversation continuity, try to find any existing conversation for this user/channel
    const query = supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .eq('platform', 'slack')
      .eq('channel_id', slackChannelId);

    if (slackThreadTs) {
      query.eq('thread_id', slackThreadTs);
    } else {
      // For non-thread messages, prefer existing non-thread conversations
      query.is('thread_id', null);
    }

    const { data: conversations } = await query.order('created_at', { ascending: false });
    
    if (conversations && conversations.length > 0) {
      const existingConversation = conversations[0];
      console.log(`🔄 Continuing existing conversation ID: ${existingConversation.id} for better continuity`);
      
      // Update last activity
      await supabase
        .from('conversations')
        .update({ 
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', existingConversation.id);
        
      return existingConversation;
    }

    console.log(`🆕 No existing conversation found, creating new one`);
    
    // Create new conversation for centralized schema
    const newConversationData = {
      platform: 'slack' as any,
      user_id: userId,
      channel_id: slackChannelId,
      thread_id: slackThreadTs || null,
      is_group_chat: false, // Assume DM for now, can be updated later
      is_dm: true,
      status: 'active' as any,
      message_count: 0,
      last_activity_at: new Date().toISOString(),
      platform_metadata: {
        slack_channel_id: slackChannelId,
        slack_thread_ts: slackThreadTs,
        created_from: 'slack_bot',
        created_at: new Date().toISOString()
      }
    };

    const { data: newConversation, error: insertError } = await supabase
      .from('conversations')
      .insert([newConversationData])
      .select()
      .single();

    if (insertError) {
      console.error('Error creating conversation:', insertError);
      return null;
    }

    console.log(`🎉 Created new conversation ID: ${newConversation.id}`);
    return newConversation;
  } catch (error) {
    console.error('Error in getOrCreateConversation:', error);
    return null;
  }
}

/**
 * Create a user query in the centralized database
 */
export async function createUserQuery(
  conversationId: string,
  userId: string,
  content: string,
  slackMessageTs?: string
): Promise<any | null> {
  try {
    const userQueryData = {
      conversation_id: conversationId,
      user_id: userId,
      content,
      platform_message_id: slackMessageTs || null,
      has_attachments: false,
      message_type: 'text',
      status: 'sent' as any,
      platform_metadata: {
        slack_message_ts: slackMessageTs,
        created_from: 'slack_bot',
        created_at: new Date().toISOString()
      }
    };

    const { data, error } = await supabase
      .from('user_queries')
      .insert([userQueryData])
      .select()
      .single();

    if (error) {
      console.error('Error creating user query:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in createUserQuery:', error);
    return null;
  }
}

/**
 * Create a bot response in the centralized database
 */
export async function createBotResponse(params: {
  query_id: string;
  conversation_id: string;
  content: string;
  slack_message_ts?: string;
  tokens_used?: number;
  model_used?: string;
  processing_time_ms?: number;
  error_message?: string;
}): Promise<any | null> {
  try {
    const botResponseData = {
      query_id: params.query_id,
      conversation_id: params.conversation_id,
      content: params.content,
      platform_message_id: params.slack_message_ts || null,
      model_used: params.model_used || 'gemini-2.0-flash',
      tokens_used: params.tokens_used,
      processing_time_ms: params.processing_time_ms,
      error_message: params.error_message,
      error_code: params.error_message ? 'AI_GENERATION_ERROR' : null,
      has_attachments: false,
      response_type: 'text',
      retry_count: 0,
      status: params.error_message ? 'failed' as any : 'sent' as any,
      platform_metadata: {
        slack_message_ts: params.slack_message_ts,
        created_from: 'slack_bot',
        created_at: new Date().toISOString()
      }
    };

    const { data, error } = await supabase
      .from('bot_responses')
      .insert([botResponseData])
      .select()
      .single();

    if (error) {
      console.error('Error creating bot response:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in createBotResponse:', error);
    return null;
  }
}

/**
 * Update bot response with Slack message timestamp
 */
export async function updateBotResponseTimestamp(
  queryId: string,
  slackMessageTs: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('bot_responses')
      .update({ slack_message_ts: slackMessageTs })
      .eq('query_id', queryId);

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
 * Get conversation history with smart context building
 */
export async function getConversationHistory(conversationId: string, limit: number = 20): Promise<any[]> {
  try {
    console.log(`🔍 Fetching conversation history for conversation ID: ${conversationId} with limit: ${limit}`);
    
    const { data: queries, error: queryError } = await supabase
      .from('user_queries')
      .select(`
        *,
        bot_responses (
          *,
          message_reactions (*)
        )
      `)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (queryError) {
      console.error('Error fetching conversation history:', queryError);
      return [];
    }

    console.log(`📊 Database returned ${queries?.length || 0} user queries for conversation ${conversationId}`);
    
    if (queries && queries.length > 0) {
      console.log(`📝 Sample query: "${queries[0].content?.substring(0, 50)}..." with ${queries[0].bot_responses?.length || 0} responses`);
    }

    // Flatten the data into a conversation flow
    const history: any[] = [];
    queries?.reverse().forEach((query: any) => {
      history.push({
        role: 'user',
        content: query.content,
        created_at: query.created_at,
      });

      if (query.bot_responses && query.bot_responses.length > 0) {
        query.bot_responses.forEach((response: any) => {
          // Format reactions for better context
          let reactionContext = '';
          if (response.message_reactions && response.message_reactions.length > 0) {
            const reactions = response.message_reactions.map((r: any) => r.reaction_name).join(', ');
            reactionContext = ` [User reacted with: ${reactions}]`;
          }

          history.push({
            role: 'assistant',
            content: response.content,
            created_at: response.created_at,
            reactions: response.message_reactions || [],
            reactionContext,
          });
        });
      }
    });

    console.log(`📚 Conversation history processed: ${history.length} total messages (queries + responses)`);
    
    return history;
  } catch (error) {
    console.error('Error in getConversationHistory:', error);
    return [];
  }
}

/**
 * Update conversation title (centralized schema)
 */
export async function updateConversationTitle(conversationId: string, title: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('conversations')
      .update({ 
        title: title,
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId);

    if (error) {
      console.error('Error updating conversation title:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in updateConversationTitle:', error);
    return false;
  }
}

/**
 * Add a reaction to a bot response (centralized schema)
 */
export async function addMessageReaction(
  responseId: string,
  slackUserId: string,
  reactionName: string
): Promise<boolean> {
  try {
    // First, find the user ID from platform_user_id
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('platform', 'slack')
      .eq('platform_user_id', slackUserId)
      .single();

    if (!user) {
      console.error('User not found for slack user ID:', slackUserId);
      return false;
    }

    // Map emoji names to unicode
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
      'smile': '😊'
    };

    const reactionData = {
      response_id: responseId,
      user_id: user.id,
      reaction_name: reactionName,
      reaction_unicode: emojiMap[reactionName] || null,
      platform: 'slack' as any
    };

    const { error } = await supabase
      .from('message_reactions')
      .upsert([reactionData], {
        onConflict: 'response_id,user_id,reaction_name'
      });

    if (error) {
      console.error('Error adding reaction:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in addMessageReaction:', error);
    return false;
  }
}

/**
 * Find bot response by Slack message timestamp (centralized schema)
 */
export async function findBotResponseByTimestamp(
  messageTs: string,
  channelId?: string
): Promise<any | null> {
  try {
    console.log('🔍 Looking for bot response with timestamp:', messageTs);
    
    // Find by platform_message_id (formerly slack_message_ts)
    const { data: response, error } = await supabase
      .from('bot_responses')
      .select('*')
      .eq('platform_message_id', messageTs)
      .single();

    if (!error && response) {
      console.log('✅ Found bot response by timestamp:', response.id);
      return response;
    }

    console.log('⚠️ No response found by timestamp, trying fallback method');
    
    // Fallback: Find recent bot responses (last 10) and assume it's one of them
    // This is for cases where old messages don't have stored timestamps
    const { data: recentResponses, error: fallbackError } = await supabase
      .from('bot_responses')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (fallbackError) {
      console.error('Error in fallback search:', fallbackError);
      return null;
    }

    if (recentResponses && recentResponses.length > 0) {
      // Return the most recent response as a best guess
      console.log('📝 Using most recent response as fallback:', recentResponses[0].id);
      return recentResponses[0];
    }

    console.log('❌ No bot responses found at all');
    return null;
  } catch (error) {
    console.error('Error in findBotResponseByTimestamp:', error);
    return null;
  }
}

/**
 * Remove a reaction from a bot response
 */
export async function removeMessageReaction(
  responseId: string,
  slackUserId: string,
  reactionName: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('message_reactions')
      .delete()
      .eq('response_id', responseId)
      .eq('slack_user_id', slackUserId)
      .eq('reaction_name', reactionName);

    if (error) {
      console.error('Error removing reaction:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in removeMessageReaction:', error);
    return false;
  }
}

/**
 * Get bot response by Slack message timestamp
 */
export async function getBotResponseBySlackTs(slackTs: string): Promise<any | null> {
  try {
    const { data, error } = await supabase
      .from('bot_responses')
      .select('*')
      .eq('slack_message_ts', slackTs)
      .single();

    if (error) {
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getBotResponseBySlackTs:', error);
    return null;
  }
}

/**
 * Delete entire conversation from database (queries, responses, conversation record)
 */
export async function deleteConversationFromDatabase(conversationId: string): Promise<boolean> {
  try {
    console.log(`🔍 Attempting to delete conversation: ${conversationId}`);
    
    // First check if the conversation exists
    const { data: conversationCheck, error: checkError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .single();
    
    if (checkError || !conversationCheck) {
      console.log(`❌ Conversation ${conversationId} not found in database`);
      return false;
    }
    
    console.log(`✅ Found conversation ${conversationId} in database`);
    
    // Check how many queries exist for this conversation
    const { data: queries, error: queryCheckError } = await supabase
      .from('user_queries')
      .select('id')
      .eq('conversation_id', conversationId);
    
    if (queryCheckError) {
      console.error('Error checking queries:', queryCheckError);
    } else {
      console.log(`📊 Found ${queries?.length || 0} user queries for conversation ${conversationId}`);
    }

    // Delete bot responses first (due to foreign key constraints)
    const { data: deletedResponses, error: responsesError } = await supabase
      .from('bot_responses')
      .delete()
      .in('query_id', 
        supabase
          .from('user_queries')
          .select('id')
          .eq('conversation_id', conversationId)
      )
      .select();

    if (responsesError) {
      console.error('Error deleting bot responses:', responsesError);
      return false;
    }
    
    console.log(`🗑️ Deleted ${deletedResponses?.length || 0} bot responses`);

    // Delete user queries
    const { data: deletedQueries, error: queriesError } = await supabase
      .from('user_queries')
      .delete()
      .eq('conversation_id', conversationId)
      .select();

    if (queriesError) {
      console.error('Error deleting user queries:', queriesError);
      return false;
    }
    
    console.log(`🗑️ Deleted ${deletedQueries?.length || 0} user queries`);

    // Delete conversation record
    const { data: deletedConversation, error: conversationError } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId)
      .select();

    if (conversationError) {
      console.error('Error deleting conversation:', conversationError);
      return false;
    }
    
    console.log(`🗑️ Deleted ${deletedConversation?.length || 0} conversation records`);

    console.log(`✅ Successfully deleted conversation ${conversationId} from database`);
    return true;
  } catch (error) {
    console.error('Error in deleteConversationFromDatabase:', error);
    return false;
  }
}