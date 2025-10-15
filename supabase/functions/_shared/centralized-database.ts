// ============================================
// CENTRALIZED DATABASE HELPER FUNCTIONS
// ============================================
// Modular, reusable functions for the new centralized multi-platform schema
// Supports: Slack, Discord, WhatsApp, Telegram, Twitch

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import type {
  User, UserInsert, UserUpdate,
  Conversation, ConversationInsert, ConversationUpdate,
  UserQuery, UserQueryInsert,
  BotResponse, BotResponseInsert,
  MessageReaction, MessageReactionInsert,
  PlatformConfig,
  PlatformType,
  ConversationMessage,
  SlackUserMetadata,
  SlackConversationMetadata,
  SlackMessageMetadata,
  CentralizedDatabase
} from '../../../src/types/centralized-database.types.ts';

// ============================================
// SUPABASE CLIENT INITIALIZATION
// ============================================

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const supabase = createClient<CentralizedDatabase>(
  supabaseUrl, 
  supabaseServiceRoleKey, 
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// ============================================
// USER MANAGEMENT FUNCTIONS
// ============================================

/**
 * Get or create a user with comprehensive error handling and metadata support
 */
export async function upsertUser(
  platform: PlatformType,
  platformUserId: string,
  userData?: Partial<UserInsert>
): Promise<{ success: boolean; user?: User; error?: string }> {
  try {
    console.log(`👤 Upserting user: ${platform}:${platformUserId}`);

    const userRecord: UserInsert = {
      platform,
      platform_user_id: platformUserId,
      username: userData?.username || null,
      display_name: userData?.display_name || platformUserId,
      email: userData?.email || null,
      phone_number: userData?.phone_number || null,
      avatar_url: userData?.avatar_url || null,
      language_code: userData?.language_code || 'en',
      timezone: userData?.timezone || null,
      is_bot: userData?.is_bot || false,
      is_active: userData?.is_active ?? true,
      notifications_enabled: userData?.notifications_enabled ?? true,
      platform_metadata: userData?.platform_metadata || {}
    };

    const { data: user, error } = await supabase
      .from('users')
      .upsert(userRecord, {
        onConflict: 'platform,platform_user_id',
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (error) {
      console.error('Error upserting user:', error);
      
      // Try to fetch existing user as fallback
      const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('platform', platform)
        .eq('platform_user_id', platformUserId)
        .single();

      if (existingUser) {
        console.log(`✅ Retrieved existing user as fallback: ${existingUser.id}`);
        return { success: true, user: existingUser };
      }

      return { success: false, error: error.message };
    }

    console.log(`✅ User upserted successfully: ${user.id}`);
    return { success: true, user };

  } catch (error) {
    console.error('Exception in upsertUser:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get user by platform and platform user ID
 */
export async function getUser(
  platform: PlatformType,
  platformUserId: string
): Promise<{ success: boolean; user?: User; error?: string }> {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('platform', platform)
      .eq('platform_user_id', platformUserId)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, user };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Update user information
 */
export async function updateUser(
  userId: string,
  updates: UserUpdate
): Promise<{ success: boolean; user?: User; error?: string }> {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, user };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// CONVERSATION MANAGEMENT FUNCTIONS
// ============================================

/**
 * Get or create a conversation with intelligent conversation continuity
 */
export async function getOrCreateConversation(
  platform: PlatformType,
  userId: string,
  channelId?: string,
  threadId?: string,
  conversationData?: Partial<ConversationInsert>
): Promise<{ success: boolean; conversation?: Conversation; error?: string }> {
  try {
    console.log(`🔍 Looking for conversation - Platform: ${platform}, User: ${userId}, Channel: ${channelId || 'DM'}, Thread: ${threadId || 'none'}`);

    // Strategy 1: If we have a thread_id, try to find exact match first
    if (threadId) {
      const { data: threadConversation } = await supabase
        .from('conversations')
        .select('*')
        .eq('platform', platform)
        .eq('user_id', userId)
        .eq('channel_id', channelId || '')
        .eq('thread_id', threadId)
        .single();

      if (threadConversation) {
        console.log(`✅ Found existing thread conversation: ${threadConversation.id}`);
        return { success: true, conversation: threadConversation };
      }
    }

    // Strategy 2: Look for recent non-thread conversation for continuity
    if (!threadId) {
      const { data: recentConversations } = await supabase
        .from('conversations')
        .select('*')
        .eq('platform', platform)
        .eq('user_id', userId)
        .eq('channel_id', channelId || '')
        .is('thread_id', null)
        .eq('status', 'active')
        .order('last_activity_at', { ascending: false })
        .limit(1);

      if (recentConversations && recentConversations.length > 0) {
        const conversation = recentConversations[0];
        console.log(`🔄 Continuing existing conversation: ${conversation.id}`);
        
        // Update last activity
        await supabase
          .from('conversations')
          .update({ last_activity_at: new Date().toISOString() })
          .eq('id', conversation.id);

        return { success: true, conversation };
      }
    }

    // Strategy 3: Create new conversation
    console.log(`🆕 Creating new conversation`);
    
    const newConversation: ConversationInsert = {
      platform,
      user_id: userId,
      channel_id: channelId || null,
      channel_name: conversationData?.channel_name || null,
      thread_id: threadId || null,
      is_group_chat: conversationData?.is_group_chat || false,
      is_dm: conversationData?.is_dm || (!channelId || channelId.startsWith('D')),
      status: 'active',
      title: conversationData?.title || null,
      platform_metadata: conversationData?.platform_metadata || {}
    };

    const { data: conversation, error } = await supabase
      .from('conversations')
      .insert([newConversation])
      .select()
      .single();

    if (error) {
      console.error('Error creating conversation:', error);
      return { success: false, error: error.message };
    }

    console.log(`🎉 Created new conversation: ${conversation.id}`);
    return { success: true, conversation };

  } catch (error) {
    console.error('Exception in getOrCreateConversation:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update conversation metadata and status
 */
export async function updateConversation(
  conversationId: string,
  updates: ConversationUpdate
): Promise<{ success: boolean; conversation?: Conversation; error?: string }> {
  try {
    const { data: conversation, error } = await supabase
      .from('conversations')
      .update(updates)
      .eq('id', conversationId)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, conversation };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Archive conversation
 */
export async function archiveConversation(
  conversationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('conversations')
      .update({ 
        status: 'archived',
        archived_at: new Date().toISOString()
      })
      .eq('id', conversationId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// MESSAGE HANDLING FUNCTIONS
// ============================================

/**
 * Save user query with comprehensive metadata
 */
export async function saveUserQuery(
  conversationId: string,
  userId: string,
  content: string,
  platformMessageId?: string,
  metadata?: {
    hasAttachments?: boolean;
    attachmentUrls?: string[];
    messageType?: string;
    platformMetadata?: any;
  }
): Promise<{ success: boolean; query?: UserQuery; error?: string }> {
  try {
    const queryData: UserQueryInsert = {
      conversation_id: conversationId,
      user_id: userId,
      content,
      platform_message_id: platformMessageId || null,
      has_attachments: metadata?.hasAttachments || false,
      attachment_urls: metadata?.attachmentUrls || null,
      message_type: metadata?.messageType || 'text',
      status: 'sent',
      platform_metadata: metadata?.platformMetadata || {}
    };

    const { data: query, error } = await supabase
      .from('user_queries')
      .insert([queryData])
      .select()
      .single();

    if (error) {
      // Handle duplicate platform message ID gracefully
      if (error.code === '23505' && error.message.includes('unique_platform_message')) {
        console.log('⚠️ Query already exists for this platform message - fetching existing');
        
        const { data: existingQuery } = await supabase
          .from('user_queries')
          .select('*')
          .eq('conversation_id', conversationId)
          .eq('platform_message_id', platformMessageId)
          .single();

        if (existingQuery) {
          return { success: true, query: existingQuery };
        }
      }

      console.error('Error saving user query:', error);
      return { success: false, error: error.message };
    }

    console.log(`💬 User query saved: ${query.id}`);
    return { success: true, query };

  } catch (error) {
    console.error('Exception in saveUserQuery:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Save bot response with AI metadata
 */
export async function saveBotResponse(
  queryId: string,
  conversationId: string,
  content: string,
  aiMetadata?: {
    platformMessageId?: string;
    modelUsed?: string;
    tokensUsed?: number;
    promptTokens?: number;
    completionTokens?: number;
    processingTimeMs?: number;
    hasAttachments?: boolean;
    attachmentUrls?: string[];
    responseType?: string;
    platformMetadata?: any;
  },
  errorData?: {
    errorMessage?: string;
    errorCode?: string;
    retryCount?: number;
  }
): Promise<{ success: boolean; response?: BotResponse; error?: string }> {
  try {
    const responseData: BotResponseInsert = {
      query_id: queryId,
      conversation_id: conversationId,
      content,
      platform_message_id: aiMetadata?.platformMessageId || null,
      model_used: aiMetadata?.modelUsed || 'gemini-2.0-flash',
      tokens_used: aiMetadata?.tokensUsed || null,
      prompt_tokens: aiMetadata?.promptTokens || null,
      completion_tokens: aiMetadata?.completionTokens || null,
      processing_time_ms: aiMetadata?.processingTimeMs || null,
      has_attachments: aiMetadata?.hasAttachments || false,
      attachment_urls: aiMetadata?.attachmentUrls || null,
      response_type: aiMetadata?.responseType || 'text',
      error_message: errorData?.errorMessage || null,
      error_code: errorData?.errorCode || null,
      retry_count: errorData?.retryCount || 0,
      status: errorData?.errorMessage ? 'failed' : 'sent',
      platform_metadata: aiMetadata?.platformMetadata || {}
    };

    const { data: response, error } = await supabase
      .from('bot_responses')
      .insert([responseData])
      .select()
      .single();

    if (error) {
      console.error('Error saving bot response:', error);
      return { success: false, error: error.message };
    }

    console.log(`🤖 Bot response saved: ${response.id}`);
    return { success: true, response };

  } catch (error) {
    console.error('Exception in saveBotResponse:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update bot response with platform message ID after successful send
 */
export async function updateBotResponsePlatformId(
  responseId: string,
  platformMessageId: string,
  additionalMetadata?: any
): Promise<{ success: boolean; error?: string }> {
  try {
    const updates: Partial<BotResponse> = {
      platform_message_id: platformMessageId
    };

    if (additionalMetadata) {
      // Merge with existing platform_metadata
      const { data: existingResponse } = await supabase
        .from('bot_responses')
        .select('platform_metadata')
        .eq('id', responseId)
        .single();

      if (existingResponse) {
        updates.platform_metadata = {
          ...existingResponse.platform_metadata,
          ...additionalMetadata
        };
      }
    }

    const { error } = await supabase
      .from('bot_responses')
      .update(updates)
      .eq('id', responseId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Find bot response by platform message ID
 */
export async function findBotResponseByPlatformMessageId(
  platformMessageId: string,
  conversationId?: string
): Promise<{ success: boolean; response?: BotResponse; error?: string }> {
  try {
    let query = supabase
      .from('bot_responses')
      .select('*')
      .eq('platform_message_id', platformMessageId);

    if (conversationId) {
      query = query.eq('conversation_id', conversationId);
    }

    const { data: response, error } = await query.single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, response };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// REACTION HANDLING FUNCTIONS
// ============================================

/**
 * Add reaction to bot response
 */
export async function addMessageReaction(
  responseId: string,
  userId: string,
  reactionName: string,
  platform: PlatformType,
  reactionUnicode?: string
): Promise<{ success: boolean; reaction?: MessageReaction; error?: string }> {
  try {
    const reactionData: MessageReactionInsert = {
      response_id: responseId,
      user_id: userId,
      reaction_name: reactionName,
      reaction_unicode: reactionUnicode || null,
      platform
    };

    const { data: reaction, error } = await supabase
      .from('message_reactions')
      .insert([reactionData])
      .select()
      .single();

    if (error) {
      // Handle duplicate reactions gracefully
      if (error.code === '23505') {
        console.log('⚠️ Reaction already exists - this is expected');
        return { success: true };
      }

      return { success: false, error: error.message };
    }

    console.log(`👍 Reaction added: ${reactionName} on response ${responseId}`);
    return { success: true, reaction };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Remove reaction from bot response
 */
export async function removeMessageReaction(
  responseId: string,
  userId: string,
  reactionName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('message_reactions')
      .update({ removed_at: new Date().toISOString() })
      .eq('response_id', responseId)
      .eq('user_id', userId)
      .eq('reaction_name', reactionName)
      .is('removed_at', null);

    if (error) {
      return { success: false, error: error.message };
    }

    console.log(`👎 Reaction removed: ${reactionName} from response ${responseId}`);
    return { success: true };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// CONVERSATION HISTORY FUNCTIONS
// ============================================

/**
 * Get conversation history with proper message ordering
 */
export async function getConversationHistory(
  conversationId: string,
  limit: number = 20,
  offset: number = 0
): Promise<{ success: boolean; messages?: ConversationMessage[]; error?: string }> {
  try {
    console.log(`📚 Fetching conversation history: ${conversationId} (limit: ${limit}, offset: ${offset})`);

    // Get user queries with their responses
    const { data: queries, error: queryError } = await supabase
      .from('user_queries')
      .select(`
        *,
        user:users(username, display_name, platform),
        bot_responses!inner (
          *,
          message_reactions (
            *,
            user:users(username, display_name, platform)
          )
        )
      `)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (queryError) {
      return { success: false, error: queryError.message };
    }

    // Flatten into chronological conversation
    const messages: ConversationMessage[] = [];
    
    queries?.reverse().forEach((query: any) => {
      // Add user query
      messages.push({
        role: 'user',
        content: query.content,
        created_at: query.created_at,
        metadata: {
          platform_message_id: query.platform_message_id
        }
      });

      // Add bot responses for this query
      query.bot_responses?.forEach((response: any) => {
        messages.push({
          role: 'assistant',
          content: response.content,
          created_at: response.created_at,
          metadata: {
            platform_message_id: response.platform_message_id,
            tokens_used: response.tokens_used,
            model_used: response.model_used,
            processing_time_ms: response.processing_time_ms,
            reactions: response.message_reactions || [],
            error_message: response.error_message
          }
        });
      });
    });

    console.log(`📖 Retrieved ${messages.length} messages from conversation ${conversationId}`);
    return { success: true, messages };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get conversation summary with stats
 */
export async function getConversationSummary(
  conversationId: string
): Promise<{ 
  success: boolean; 
  summary?: {
    conversation: Conversation;
    user: User;
    messageCount: number;
    lastActivity: string;
    reactionCount: number;
    avgResponseTime: number;
  }; 
  error?: string 
}> {
  try {
    // Get conversation with user
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        *,
        user:users(*)
      `)
      .eq('id', conversationId)
      .single();

    if (convError) {
      return { success: false, error: convError.message };
    }

    // Get stats
    const { data: stats } = await supabase.rpc('get_conversation_stats', {
      conversation_id: conversationId
    });

    const summary = {
      conversation: conversation,
      user: conversation.user,
      messageCount: conversation.message_count,
      lastActivity: conversation.last_activity_at,
      reactionCount: stats?.reaction_count || 0,
      avgResponseTime: stats?.avg_response_time || 0
    };

    return { success: true, summary };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// PLATFORM CONFIGURATION FUNCTIONS
// ============================================

/**
 * Get platform configuration
 */
export async function getPlatformConfig(
  platform: PlatformType
): Promise<{ success: boolean; config?: PlatformConfig; error?: string }> {
  try {
    const { data: config, error } = await supabase
      .from('platform_configs')
      .select('*')
      .eq('platform', platform)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, config };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// SLACK-SPECIFIC HELPER FUNCTIONS
// ============================================

/**
 * Create Slack user with proper metadata
 */
export async function createSlackUser(
  slackUserId: string,
  userInfo: any,
  teamId: string
): Promise<{ success: boolean; user?: User; error?: string }> {
  const slackMetadata: SlackUserMetadata = {
    team_id: teamId,
    enterprise_id: userInfo.enterprise_user?.enterprise_id,
    is_enterprise_install: userInfo.enterprise_user?.is_enterprise_install || false,
    is_admin: userInfo.is_admin || false,
    is_owner: userInfo.is_owner || false,
    is_primary_owner: userInfo.is_primary_owner || false,
    is_restricted: userInfo.is_restricted || false,
    is_ultra_restricted: userInfo.is_ultra_restricted || false,
    is_stranger: userInfo.is_stranger || false,
    is_app_user: userInfo.is_app_user || false,
    has_2fa: userInfo.has_2fa || false,
    locale: userInfo.locale,
    tz: userInfo.tz,
    tz_label: userInfo.tz_label,
    tz_offset: userInfo.tz_offset
  };

  return await upsertUser('slack', slackUserId, {
    username: userInfo.name,
    display_name: userInfo.real_name || userInfo.display_name || userInfo.name,
    email: userInfo.profile?.email,
    avatar_url: userInfo.profile?.image_192 || userInfo.profile?.image_72,
    timezone: userInfo.tz,
    is_bot: userInfo.is_bot || false,
    platform_metadata: slackMetadata
  });
}

/**
 * Create Slack conversation with proper metadata
 */
export async function createSlackConversation(
  userId: string,
  channelId: string,
  channelInfo: any,
  threadTs?: string
): Promise<{ success: boolean; conversation?: Conversation; error?: string }> {
  const slackMetadata: SlackConversationMetadata = {
    team: channelInfo.context_team_id || 'unknown',
    channel_type: channelInfo.is_im ? 'im' : 
                 channelInfo.is_mpim ? 'mpim' :
                 channelInfo.is_private ? 'private_channel' : 'public_channel',
    is_archived: channelInfo.is_archived || false,
    is_general: channelInfo.is_general || false,
    is_starred: channelInfo.is_starred || false,
    is_member: channelInfo.is_member || true,
    topic: channelInfo.topic?.value,
    purpose: channelInfo.purpose?.value,
    num_members: channelInfo.num_members,
    previous_names: channelInfo.previous_names
  };

  return await getOrCreateConversation('slack', userId, channelId, threadTs, {
    channel_name: channelInfo.name,
    is_group_chat: channelInfo.is_group || channelInfo.is_mpim || false,
    is_dm: channelInfo.is_im || false,
    platform_metadata: slackMetadata
  });
}

// ============================================
// EXPORT ALL FUNCTIONS
// ============================================

export {
  // Core exports are already defined above
};

// Helper object for easy importing
export const CentralizedDB = {
  // User functions
  upsertUser,
  getUser,
  updateUser,
  
  // Conversation functions
  getOrCreateConversation,
  updateConversation,
  archiveConversation,
  
  // Message functions
  saveUserQuery,
  saveBotResponse,
  updateBotResponsePlatformId,
  findBotResponseByPlatformMessageId,
  
  // Reaction functions
  addMessageReaction,
  removeMessageReaction,
  
  // History functions
  getConversationHistory,
  getConversationSummary,
  
  // Platform functions
  getPlatformConfig,
  
  // Slack-specific functions
  createSlackUser,
  createSlackConversation
};