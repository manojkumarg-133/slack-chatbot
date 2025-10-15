// Database helper functions for NEW SCHEMA with separate user_queries and bot_responses tables
import { supabase } from './supabaseClient';
import type { 
  User, 
  UserInsert, 
  Conversation, 
  ConversationInsert, 
  UserQuery,
  UserQueryInsert,
  BotResponse,
  BotResponseInsert,
  MessageReaction,
  MessageReactionInsert
} from '@/types/database.types';

/**
 * Get or create a user in the database
 */
export async function getOrCreateUser(slackUserId: string, userData?: Partial<UserInsert>): Promise<User | null> {
  try {
    console.log(`👤 Getting or creating user: ${slackUserId}`);
    
    // Use upsert to handle race conditions and duplicate key constraints
    const { data: user, error } = await supabase
      .from('users')
      .upsert(
        { 
          slack_user_id: slackUserId, 
          ...userData 
        },
        { 
          onConflict: 'slack_user_id',
          ignoreDuplicates: false 
        }
      )
      .select()
      .single();

    if (error) {
      console.error('Error upserting user:', error);
      
      // If upsert fails, try to fetch existing user as fallback
      const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('slack_user_id', slackUserId)
        .single();
      
      if (existingUser) {
        console.log(`✅ Found existing user as fallback: ${existingUser.id}`);
        return existingUser as User;
      }
      
      return null;
    }

    console.log(`✅ User ready: ${user.id} (${user.slack_user_id})`);
    return user as User;
  } catch (error) {
    console.error('Error in getOrCreateUser:', error);
    
    // Last resort: try to fetch existing user
    try {
      const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('slack_user_id', slackUserId)
        .single();
      
      if (existingUser) {
        console.log(`🔄 Recovered existing user: ${existingUser.id}`);
        return existingUser as User;
      }
    } catch (e) {
      console.error('Failed to recover existing user:', e);
    }
    
    return null;
  }
}

/**
 * Get or create a conversation
 * Enhanced logic for better conversation continuity
 */
export async function getOrCreateConversation(
  userId: string,
  slackChannelId: string,
  slackThreadTs?: string
): Promise<Conversation | null> {
  try {
    console.log(`🔍 Looking for conversation - User: ${userId}, Channel: ${slackChannelId}, Thread: ${slackThreadTs || 'none'}`);
    
    // Strategy 1: If we have a thread_ts, try to find exact match first
    if (slackThreadTs) {
      const { data: threadConversation } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', userId)
        .eq('slack_channel_id', slackChannelId)
        .eq('slack_thread_ts', slackThreadTs)
        .single();

      if (threadConversation) {
        console.log(`✅ Found existing thread conversation ID: ${threadConversation.id}`);
        return threadConversation as Conversation;
      }
    }

    // Strategy 2: Look for the most recent conversation for this user in this channel
    // This provides better continuity for ongoing conversations
    const { data: recentConversations } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .eq('slack_channel_id', slackChannelId)
      .is('slack_thread_ts', null) // Only consider non-threaded conversations for continuity
      .order('updated_at', { ascending: false })
      .limit(1);

    // If we found a recent conversation and we're not in a specific thread, use it for continuity
    if (recentConversations && recentConversations.length > 0 && !slackThreadTs) {
      console.log(`🔄 Continuing existing conversation ID: ${recentConversations[0].id} for better continuity`);
      
      // Update the conversation's timestamp to show recent activity
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', recentConversations[0].id);
      
      return recentConversations[0] as Conversation;
    }

    console.log(`🆕 Creating new conversation (Thread: ${slackThreadTs ? 'Yes' : 'No'})`);
    
    // Create new conversation
    const { data: newConversation, error: insertError } = await supabase
      .from('conversations')
      .insert([{
        user_id: userId,
        slack_channel_id: slackChannelId,
        slack_thread_ts: slackThreadTs || null,
      }])
      .select()
      .single();

    if (insertError) {
      console.error('Error creating conversation:', insertError);
      return null;
    }

    console.log(`🎉 Created new conversation ID: ${newConversation.id}`);
    return newConversation as Conversation;
  } catch (error) {
    console.error('Error in getOrCreateConversation:', error);
    return null;
  }
}

/**
 * Create a user query in the database
 */
export async function createUserQuery(
  conversationId: string,
  content: string,
  slackMessageTs?: string
): Promise<UserQuery | null> {
  try {
    const { data, error } = await supabase
      .from('user_queries')
      .insert([{
        conversation_id: conversationId,
        content,
        slack_message_ts: slackMessageTs || null,
      }])
      .select()
      .single();

    if (error) {
      // Handle duplicate constraint errors gracefully
      if (error.code === '23505' && error.message.includes('unique_slack_message')) {
        console.log('⚠️ Query already exists for this Slack message - this is expected for retries');
        
        // Try to find the existing query
        const { data: existingQuery } = await supabase
          .from('user_queries')
          .select('*')
          .eq('conversation_id', conversationId)
          .eq('slack_message_ts', slackMessageTs)
          .single();
          
        return existingQuery as UserQuery || null;
      }
      
      console.error('Error creating user query:', error);
      return null;
    }

    return data as UserQuery;
  } catch (error) {
    console.error('Error in createUserQuery:', error);
    return null;
  }
}

/**
 * Create a bot response in the database
 */
export async function createBotResponse(params: {
  query_id: string;
  content: string;
  slack_message_ts?: string;
  tokens_used?: number;
  model_used?: string;
  processing_time_ms?: number;
  error_message?: string;
}): Promise<BotResponse | null> {
  try {
    const { data, error } = await supabase
      .from('bot_responses')
      .insert([{
        query_id: params.query_id,
        content: params.content,
        slack_message_ts: params.slack_message_ts || null,
        tokens_used: params.tokens_used || null,
        model_used: params.model_used || 'gemini-2.0-flash',
        processing_time_ms: params.processing_time_ms || null,
        error_message: params.error_message || null,
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating bot response:', error);
      return null;
    }

    return data as BotResponse;
  } catch (error) {
    console.error('Error in createBotResponse:', error);
    return null;
  }
}

/**
 * Get conversation history (queries and responses) with reactions
 */
export async function getConversationHistory(conversationId: string, limit: number = 10): Promise<any[]> {
  try {
    console.log(`🔍 Fetching conversation history for conversation ID: ${conversationId} with limit: ${limit}`);
    
    // Get user queries with their responses and reactions
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
    
    // Log a sample of the conversation for debugging
    if (history.length > 0) {
      console.log(`🔍 Conversation sample - First message: "${history[0]?.content?.substring(0, 60)}..."`);
      if (history.length > 1) {
        console.log(`🔍 Conversation sample - Last message: "${history[history.length - 1]?.content?.substring(0, 60)}..."`);
      }
    }
    
    return history;
  } catch (error) {
    console.error('Error in getConversationHistory:', error);
    return [];
  }
}

/**
 * Update conversation title
 */
export async function updateConversationTitle(conversationId: string, title: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('conversations')
      .update({ conversation_title: title })
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
 * Add a reaction to a bot response
 */
export async function addMessageReaction(
  responseId: string,
  slackUserId: string,
  reactionName: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('message_reactions')
      .insert([{
        response_id: responseId,
        slack_user_id: slackUserId,
        reaction_name: reactionName,
      }]);

    if (error) {
      // Ignore duplicate reactions
      if (error.code === '23505') {
        console.log('Reaction already exists');
        return true;
      }
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
 * SLASH COMMAND FUNCTIONS
 */

/**
 * Mark a conversation as cleared (doesn't delete data, just marks it)
 * This allows users to start fresh while preserving data
 */
export async function clearConversation(conversationId: string): Promise<boolean> {
  try {
    // Update conversation to mark as cleared and reset title
    const { error } = await supabase
      .from('conversations')
      .update({ 
        conversation_title: 'Cleared Chat',
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId);

    if (error) {
      console.error('Error clearing conversation:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in clearConversation:', error);
    return false;
  }
}

/**
 * Create a new conversation for the same user
 * Used for /new command
 */
export async function createNewConversation(userId: string, slackChannelId: string): Promise<Conversation | null> {
  try {
    const conversationData: ConversationInsert = {
      user_id: userId,
      slack_channel_id: slackChannelId,
      conversation_title: 'New Chat',
      status: 'active'
    };

    const { data, error } = await supabase
      .from('conversations')
      .insert(conversationData)
      .select()
      .single();

    if (error) {
      console.error('Error creating new conversation:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in createNewConversation:', error);
    return null;
  }
}

/**
 * Delete all data for a conversation (user_queries, bot_responses, reactions)
 * Used for /delete command - PERMANENT deletion
 */
export async function deleteConversationCompletely(conversationId: string): Promise<boolean> {
  try {
    // Delete in correct order to handle foreign key constraints
    
    // 1. Get all user query IDs for this conversation
    const { data: userQueries } = await supabase
      .from('user_queries')
      .select('id')
      .eq('conversation_id', conversationId);

    if (userQueries && userQueries.length > 0) {
      const queryIds = userQueries.map(q => q.id);

      // 2. Get all bot response IDs for these queries
      const { data: botResponses } = await supabase
        .from('bot_responses')
        .select('id')
        .in('query_id', queryIds);

      if (botResponses && botResponses.length > 0) {
        const responseIds = botResponses.map(r => r.id);

        // 3. Delete message reactions first (they reference bot_responses)
        const { error: reactionsError } = await supabase
          .from('message_reactions')
          .delete()
          .in('response_id', responseIds);

        if (reactionsError) {
          console.error('Error deleting reactions:', reactionsError);
        }
      }

      // 4. Delete bot responses (they reference user_queries)
      const { error: responsesError } = await supabase
        .from('bot_responses')
        .delete()
        .in('query_id', queryIds);

      if (responsesError) {
        console.error('Error deleting bot responses:', responsesError);
      }
    }

    // 5. Delete user queries
    const { error: queriesError } = await supabase
      .from('user_queries')
      .delete()
      .eq('conversation_id', conversationId);

    if (queriesError) {
      console.error('Error deleting user queries:', queriesError);
    }

    // 6. Finally delete the conversation itself
    const { error: conversationError } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId);

    if (conversationError) {
      console.error('Error deleting conversation:', conversationError);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in deleteConversationCompletely:', error);
    return false;
  }
}

/**
 * Get bot response by Slack message timestamp
 */
export async function getBotResponseBySlackTs(slackMessageTs: string): Promise<BotResponse | null> {
  try {
    const { data, error } = await supabase
      .from('bot_responses')
      .select('*')
      .eq('slack_message_ts', slackMessageTs)
      .single();

    if (error) {
      console.error('Error fetching bot response by slack_message_ts:', error);
      return null;
    }

    return data as BotResponse;
  } catch (error) {
    console.error('Error in getBotResponseBySlackTs:', error);
    return null;
  }
}

/**
 * Get reactions for a bot response
 */
export async function getReactionsForResponse(responseId: string): Promise<MessageReaction[]> {
  try {
    const { data, error } = await supabase
      .from('message_reactions')
      .select('*')
      .eq('response_id', responseId);

    if (error) {
      console.error('Error fetching reactions:', error);
      return [];
    }

    return data as MessageReaction[];
  } catch (error) {
    console.error('Error in getReactionsForResponse:', error);
    return [];
  }
}

/**
 * Get user statistics (for analytics endpoint)
 */
export async function getUserStats(slackUserId: string): Promise<{
  totalConversations: number;
  totalQueries: number;
  totalResponses: number;
  totalReactions: number;
} | null> {
  try {
    // Get user first
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('slack_user_id', slackUserId)
      .single();

    if (!user) {
      return {
        totalConversations: 0,
        totalQueries: 0,
        totalResponses: 0,
        totalReactions: 0
      };
    }

    // Count conversations
    const { count: conversationCount } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    // Get all conversations for this user
    const { data: conversations } = await supabase
      .from('conversations')
      .select('id')
      .eq('user_id', user.id);

    let totalQueries = 0;
    let totalResponses = 0;
    let totalReactions = 0;

    if (conversations && conversations.length > 0) {
      const conversationIds = conversations.map(c => c.id);

      // Count queries across all conversations
      const { count: queryCount } = await supabase
        .from('user_queries')
        .select('*', { count: 'exact', head: true })
        .in('conversation_id', conversationIds);

      totalQueries = queryCount || 0;

      // Get all user queries to count responses
      const { data: userQueries } = await supabase
        .from('user_queries')
        .select('id')
        .in('conversation_id', conversationIds);

      if (userQueries && userQueries.length > 0) {
        const queryIds = userQueries.map(q => q.id);

        // Count responses
        const { count: responseCount } = await supabase
          .from('bot_responses')
          .select('*', { count: 'exact', head: true })
          .in('query_id', queryIds);

        totalResponses = responseCount || 0;

        // Get response IDs to count reactions
        const { data: botResponses } = await supabase
          .from('bot_responses')
          .select('id')
          .in('query_id', queryIds);

        if (botResponses && botResponses.length > 0) {
          const responseIds = botResponses.map(r => r.id);

          // Count reactions
          const { count: reactionCount } = await supabase
            .from('message_reactions')
            .select('*', { count: 'exact', head: true })
            .in('response_id', responseIds);

          totalReactions = reactionCount || 0;
        }
      }
    }

    return {
      totalConversations: conversationCount || 0,
      totalQueries,
      totalResponses,
      totalReactions
    };
  } catch (error) {
    console.error('Error in getUserStats:', error);
    return null;
  }
}

/**
 * Get conversation statistics for user (for /clear and /delete confirmations)
 */
export async function getConversationStats(conversationId: string): Promise<{
  queryCount: number;
  responseCount: number;
  reactionCount: number;
} | null> {
  try {
    // Count user queries
    const { count: queryCount, error: queryError } = await supabase
      .from('user_queries')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId);

    if (queryError) {
      console.error('Error counting queries:', queryError);
      return null;
    }

    // Get user query IDs first
    const { data: userQueries } = await supabase
      .from('user_queries')
      .select('id')
      .eq('conversation_id', conversationId);

    let responseCount = 0;
    let reactionCount = 0;

    if (userQueries && userQueries.length > 0) {
      const queryIds = userQueries.map(q => q.id);

      // Count bot responses
      const { count: respCount, error: responseError } = await supabase
        .from('bot_responses')
        .select('*', { count: 'exact', head: true })
        .in('query_id', queryIds);

      if (responseError) {
        console.error('Error counting responses:', responseError);
      } else {
        responseCount = respCount || 0;
      }

      // Get bot response IDs for counting reactions
      const { data: botResponses } = await supabase
        .from('bot_responses')
        .select('id')
        .in('query_id', queryIds);

      if (botResponses && botResponses.length > 0) {
        const responseIds = botResponses.map(r => r.id);

        // Count reactions
        const { count: reactCount, error: reactionError } = await supabase
          .from('message_reactions')
          .select('*', { count: 'exact', head: true })
          .in('response_id', responseIds);

        if (reactionError) {
          console.error('Error counting reactions:', reactionError);
        } else {
          reactionCount = reactCount || 0;
        }
      }
    }

    return {
      queryCount: queryCount || 0,
      responseCount,
      reactionCount
    };
  } catch (error) {
    console.error('Error in getConversationStats:', error);
    return null;
  }
}
