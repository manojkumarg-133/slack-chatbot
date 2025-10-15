// Slack helper functions
import { WebClient } from '@slack/web-api';

let slackClient: WebClient | null = null;

/**
 * Initialize Slack Web Client
 */
export function initializeSlackClient(): WebClient {
  if (!slackClient) {
    slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
  }
  return slackClient;
}

/**
 * Get Slack user information
 */
export async function getSlackUserInfo(userId: string) {
  try {
    const client = initializeSlackClient();
    const result = await client.users.info({ user: userId });
    
    if (result.ok && result.user) {
      return {
        slack_user_id: result.user.id!,
        slack_team_id: result.user.team_id,
        username: result.user.name,
        display_name: result.user.profile?.display_name || result.user.real_name,
        email: result.user.profile?.email,
        avatar_url: result.user.profile?.image_192
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching Slack user info:', error);
    return null;
  }
}

/**
 * Send a typing indicator message
 */
export async function sendTypingIndicator(channel: string, threadTs?: string) {
  const thinkingMessages = [
    "🤔 Let me think about that...",
    "💭 Processing your request...",
    "⚡ Generating response...",
    "🧠 Thinking...",
    "✨ Working on it..."
  ];
  
  const randomMessage = thinkingMessages[Math.floor(Math.random() * thinkingMessages.length)];
  return await sendSlackMessage(channel, randomMessage, threadTs);
}

/**
 * Send a message to Slack with automatic truncation for long content
 */
export async function sendSlackMessage(channel: string, text: string, threadTs?: string) {
  try {
    const client = initializeSlackClient();
    
    // Truncate if necessary
    const truncatedText = truncateText(text);
    
    const result = await client.chat.postMessage({
      channel,
      text: truncatedText,
      thread_ts: threadTs
    });
    return result;
  } catch (error) {
    console.error('Error sending Slack message:', error);
    return null;
  }
}

/**
 * Truncate text to fit Slack's message limit (40,000 characters)
 * Leaves room for truncation message
 */
function truncateText(text: string, maxLength: number = 39500): string {
  if (text.length <= maxLength) {
    return text;
  }
  
  const truncated = text.substring(0, maxLength);
  const truncationMsg = `\n\n...\n\n_⚠️ Response truncated (${text.length.toLocaleString()} characters). The full response was too long for Slack's message limit._`;
  
  return truncated + truncationMsg;
}

/**
 * Update a Slack message with automatic truncation for long content
 */
export async function updateSlackMessage(channel: string, ts: string, text: string) {
  try {
    const client = initializeSlackClient();
    
    // Truncate if necessary
    const truncatedText = truncateText(text);
    
    const result = await client.chat.update({
      channel,
      ts,
      text: truncatedText
    });
    return result;
  } catch (error) {
    console.error('Error updating Slack message:', error);
    return null;
  }
}

/**
 * Add a reaction to a message
 */
export async function addSlackReaction(channel: string, timestamp: string, reactionName: string) {
  try {
    const client = initializeSlackClient();
    await client.reactions.add({
      channel,
      timestamp,
      name: reactionName
    });
    return true;
  } catch (error) {
    console.error('Error adding Slack reaction:', error);
    return false;
  }
}
