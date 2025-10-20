// Slash command helper functions for the chatbot
import { supabase } from './supabaseClient';

/**
 * Simple conversation operations for slash commands
 */

/**
 * Mark conversation as cleared (soft delete - preserves data)
 */
export async function clearConversation(conversationId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('conversations')
      .update({ title: 'Cleared Chat' })
      .eq('id', conversationId);

    return !error;
  } catch (error) {
    console.error('Error clearing conversation:', error);
    return false;
  }
}

/**
 * Create new conversation for user
 */
export async function createNewConversationForUser(
  userId: string, 
  slackChannelId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .insert({
        platform: 'slack',
        user_id: userId,
        channel_id: slackChannelId,
        title: 'New Chat',
        updated_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error || !data) {
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
 * Delete conversation and all related data (hard delete)
 */
export async function deleteConversationData(conversationId: string): Promise<boolean> {
  try {
    // Get all user queries for this conversation
    const { data: queries } = await supabase
      .from('user_queries')
      .select('id')
      .eq('conversation_id', conversationId);

    if (queries && queries.length > 0) {
      const queryIds = queries.map(q => q.id);
      
      // Get all bot responses for these queries
      const { data: responses } = await supabase
        .from('bot_responses')
        .select('id')
        .in('query_id', queryIds);

      if (responses && responses.length > 0) {
        const responseIds = responses.map(r => r.id);
        
        // Delete reactions first
        await supabase
          .from('message_reactions')
          .delete()
          .in('response_id', responseIds);
        
        // Delete bot responses
        await supabase
          .from('bot_responses')
          .delete()
          .in('query_id', queryIds);
      }
      
      // Delete user queries
      await supabase
        .from('user_queries')
        .delete()
        .eq('conversation_id', conversationId);
    }

    // Delete conversation
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId);

    return !error;
  } catch (error) {
    console.error('Error deleting conversation:', error);
    return false;
  }
}

/**
 * Get conversation statistics
 */
export async function getConversationStats(conversationId: string): Promise<{
  messageCount: number;
  responseCount: number;
  reactionCount: number;
} | null> {
  try {
    // Count user queries
    const { count: messageCount } = await supabase
      .from('user_queries')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId);

    // Get query IDs
    const { data: queries } = await supabase
      .from('user_queries')
      .select('id')
      .eq('conversation_id', conversationId);

    let responseCount = 0;
    let reactionCount = 0;

    if (queries && queries.length > 0) {
      const queryIds = queries.map(q => q.id);
      
      // Count bot responses
      const { count: responses } = await supabase
        .from('bot_responses')
        .select('*', { count: 'exact', head: true })
        .in('query_id', queryIds);
      
      responseCount = responses || 0;

      // Get response IDs for reaction count
      const { data: responseData } = await supabase
        .from('bot_responses')
        .select('id')
        .in('query_id', queryIds);

      if (responseData && responseData.length > 0) {
        const responseIds = responseData.map(r => r.id);
        
        const { count: reactions } = await supabase
          .from('message_reactions')
          .select('*', { count: 'exact', head: true })
          .in('response_id', responseIds);
        
        reactionCount = reactions || 0;
      }
    }

    return {
      messageCount: messageCount || 0,
      responseCount,
      reactionCount
    };
  } catch (error) {
    console.error('Error getting conversation stats:', error);
    return null;
  }
}

/**
 * User mute status management
 */
const mutedUsers = new Set<string>();

export function muteUser(slackUserId: string): boolean {
  mutedUsers.add(slackUserId);
  console.log(`🔇 User ${slackUserId} muted`);
  return true;
}

export function unmuteUser(slackUserId: string): boolean {
  const wasMuted = mutedUsers.delete(slackUserId);
  if (wasMuted) {
    console.log(`🔊 User ${slackUserId} unmuted`);
  }
  return wasMuted;
}

export function isUserMuted(slackUserId: string): boolean {
  return mutedUsers.has(slackUserId);
}

export function getMutedUsers(): string[] {
  return Array.from(mutedUsers);
}