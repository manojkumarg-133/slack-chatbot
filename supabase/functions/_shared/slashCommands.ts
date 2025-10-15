// Slash commands helper functions for Supabase Edge Functions
import { supabase, deleteConversationFromDatabase } from './database.ts';
import { clearScreenMessages } from './slack.ts';

// Muted users storage (in production, you might want to use a database table)
const mutedUsers = new Set<string>();

/**
 * Clear conversation history (soft delete)
 */
export async function clearConversation(conversationId: string): Promise<boolean> {
  try {
    // Soft delete user queries
    const { error: queryError } = await supabase
      .from('user_queries')
      .update({ deleted_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .is('deleted_at', null);

    if (queryError) {
      console.error('Error soft deleting user queries:', queryError);
      return false;
    }

    // Soft delete bot responses via user queries
    const { data: queries } = await supabase
      .from('user_queries')
      .select('id')
      .eq('conversation_id', conversationId);

    if (queries && queries.length > 0) {
      const queryIds = queries.map(q => q.id);
      
      const { error: responseError } = await supabase
        .from('bot_responses')
        .update({ deleted_at: new Date().toISOString() })
        .in('query_id', queryIds)
        .is('deleted_at', null);

      if (responseError) {
        console.error('Error soft deleting bot responses:', responseError);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Error in clearConversation:', error);
    return false;
  }
}

/**
 * Create a new conversation for user
 */
export async function createNewConversationForUser(
  userId: string, 
  channelId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .insert([{
        user_id: userId,
        slack_channel_id: channelId,
        conversation_title: 'New Chat Session'
      }])
      .select('id')
      .single();

    if (error) {
      console.error('Error creating new conversation:', error);
      return null;
    }

    return data.id;
  } catch (error) {
    console.error('Error in createNewConversationForUser:', error);
    return null;
  }
}

/**
 * Delete all conversation data for a user (hard delete)
 */
export async function deleteConversationData(conversationId: string): Promise<boolean> {
  try {
    console.log(`🔍 [deleteConversationData] Attempting to delete conversation: ${conversationId}`);
    
    // Get all user queries for this conversation
    const { data: queries, error: queryError } = await supabase
      .from('user_queries')
      .select('id')
      .eq('conversation_id', conversationId);

    if (queryError) {
      console.error('Error fetching queries:', queryError);
      return false;
    }

    console.log(`📊 [deleteConversationData] Found ${queries?.length || 0} queries for conversation ${conversationId}`);

    if (queries && queries.length > 0) {
      const queryIds = queries.map(q => q.id);

      // Delete message reactions first (foreign key constraint)
      const { data: responses } = await supabase
        .from('bot_responses')
        .select('id')
        .in('query_id', queryIds);

      if (responses && responses.length > 0) {
        const responseIds = responses.map(r => r.id);
        
        await supabase
          .from('message_reactions')
          .delete()
          .in('response_id', responseIds);
      }

      // Delete bot responses
      await supabase
        .from('bot_responses')
        .delete()
        .in('query_id', queryIds);

      // Delete user queries
      await supabase
        .from('user_queries')
        .delete()
        .eq('conversation_id', conversationId);
    }

    // Delete the conversation
    const { data: deletedConversation, error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId)
      .select();

    if (error) {
      console.error('Error deleting conversation:', error);
      return false;
    }

    console.log(`✅ [deleteConversationData] Deleted ${deletedConversation?.length || 0} conversation records`);
    console.log(`🗑️ [deleteConversationData] Successfully deleted conversation ${conversationId}`);

    return true;
  } catch (error) {
    console.error('Error in deleteConversationData:', error);
    return false;
  }
}

/**
 * Get conversation statistics
 */
export async function getConversationStats(conversationId: string): Promise<{
  messageCount: number;
  lastActivity: string | null;
} | null> {
  try {
    const { data: queries } = await supabase
      .from('user_queries')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (!queries) return null;

    return {
      messageCount: queries.length,
      lastActivity: queries.length > 0 ? queries[0].created_at : null
    };
  } catch (error) {
    console.error('Error in getConversationStats:', error);
    return null;
  }
}

/**
 * Mute user (prevent bot responses)
 */
export function muteUser(userId: string): boolean {
  try {
    mutedUsers.add(userId);
    return true;
  } catch (error) {
    console.error('Error muting user:', error);
    return false;
  }
}

/**
 * Unmute user (re-enable bot responses)
 */
export function unmuteUser(userId: string): boolean {
  try {
    mutedUsers.delete(userId);
    return true;
  } catch (error) {
    console.error('Error unmuting user:', error);
    return false;
  }
}

/**
 * Check if user is muted
 */
export function isUserMuted(userId: string): boolean {
  return mutedUsers.has(userId);
}