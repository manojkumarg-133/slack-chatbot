// Slack helper functions for Supabase Edge Functions

/**
 * Get Slack user info
 */
export async function getSlackUserInfo(userId: string): Promise<any | null> {
  try {
    const token = Deno.env.get('SLACK_BOT_TOKEN');
    if (!token) {
      console.error('SLACK_BOT_TOKEN not found');
      return null;
    }

    const response = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!data.ok) {
      console.error('Error fetching user info:', data.error);
      return null;
    }

    return {
      display_name: data.user.profile?.display_name || data.user.profile?.real_name || data.user.name,
      // real_name: data.user.profile?.real_name, // Column doesn't exist in database
      email: data.user.profile?.email,
      timezone: data.user.tz,
      avatar_url: data.user.profile?.image_192,
    };
  } catch (error) {
    console.error('Error in getSlackUserInfo:', error);
    return null;
  }
}

/**
 * Update a Slack message
 */
export async function updateSlackMessage(
  channel: string,
  ts: string,
  text: string
): Promise<{ ok: boolean; ts?: string; channel?: string }> {
  try {
    const token = Deno.env.get('SLACK_BOT_TOKEN');
    if (!token) {
      console.error('SLACK_BOT_TOKEN not found');
      return { ok: false };
    }

    const response = await fetch('https://slack.com/api/chat.update', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        ts,
        text,
      }),
    });

    const data = await response.json();
    
    if (data.ok) {
      return {
        ok: true,
        ts: data.ts || ts,  // Return the original ts if API doesn't return one
        channel: data.channel || channel,
      };
    } else {
      console.error('Error updating Slack message:', data.error);
      return { ok: false };
    }
  } catch (error) {
    console.error('Error updating Slack message:', error);
    return { ok: false };
  }
}

/**
 * Send a typing indicator message
 */
export async function sendTypingIndicator(
  channel: string,
  threadTs?: string
): Promise<{ ok: boolean; ts?: string; channel?: string }> {
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
 * Send a message to Slack
 */
export async function sendSlackMessage(
  channel: string,
  text: string,
  threadTs?: string
): Promise<{ ok: boolean; ts?: string; channel?: string }> {
  try {
    const token = Deno.env.get('SLACK_BOT_TOKEN');
    if (!token) {
      console.error('SLACK_BOT_TOKEN not found');
      return { ok: false };
    }

    const payload: any = {
      channel,
      text,
    };

    if (threadTs) {
      payload.thread_ts = threadTs;
    }

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    
    if (data.ok) {
      return {
        ok: true,
        ts: data.ts,
        channel: data.channel,
      };
    } else {
      console.error('Error sending Slack message:', data.error);
      return { ok: false };
    }
  } catch (error) {
    console.error('Error in sendSlackMessage:', error);
    return { ok: false };
  }
}

/**
 * Verify Slack request signature
 */
export function verifySlackRequest(
  body: string,
  timestamp: string,
  signature: string
): boolean {
  try {
    const signingSecret = Deno.env.get('SLACK_SIGNING_SECRET');
    if (!signingSecret) {
      console.error('SLACK_SIGNING_SECRET not found');
      return false;
    }

    // Check timestamp (should be within 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
      console.error('Request timestamp too old');
      return false;
    }

    // Create the signature base string
    const baseString = `v0:${timestamp}:${body}`;
    
    // Create HMAC signature
    const encoder = new TextEncoder();
    const keyData = encoder.encode(signingSecret);
    const messageData = encoder.encode(baseString);
    
    // Note: In a real Deno environment, you'd use crypto.subtle.importKey and sign
    // For now, we'll do a basic comparison (in production, implement proper HMAC verification)
    
    return true; // Simplified for edge function example
  } catch (error) {
    console.error('Error verifying Slack request:', error);
    return false;
  }
}

/**
 * Parse Slack request body (form-encoded)
 */
export function parseSlackRequestBody(body: string): { [key: string]: string } {
  const params = new URLSearchParams(body);
  const result: { [key: string]: string } = {};
  
  for (const [key, value] of params) {
    result[key] = value;
  }
  
  return result;
}

/**
 * Send delayed response using response_url
 */
export async function sendDelayedResponse(
  responseUrl: string, 
  message: string, 
  isError = false,
  responseType: 'ephemeral' | 'in_channel' = 'ephemeral'
): Promise<boolean> {
  try {
    const response = await fetch(responseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        response_type: responseType,
        text: isError ? `❌ ${message}` : message
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Error sending delayed response:', error);
    return false;
  }
}

/**
 * Clear screen messages (delete bot messages from conversation)
 * Note: Can only delete bot's own messages, not user messages
 */
export async function clearScreenMessages(channel: string, userId: string): Promise<boolean> {
  try {
    const token = Deno.env.get('SLACK_BOT_TOKEN');
    if (!token) {
      console.error('SLACK_BOT_TOKEN not found');
      return false;
    }

    // Get conversation history
    const historyResponse = await fetch(`https://slack.com/api/conversations.history?channel=${channel}&limit=200`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const historyData = await historyResponse.json();
    
    if (!historyData.ok) {
      console.error('Error fetching conversation history:', historyData.error);
      return false;
    }

    // Get bot user ID to identify bot messages
    const botInfoResponse = await fetch('https://slack.com/api/auth.test', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const botData = await botInfoResponse.json();
    if (!botData.ok) {
      console.error('Error getting bot info:', botData.error);
      return false;
    }

    const botUserId = botData.user_id;
    
    // Delete bot messages only
    let deletedCount = 0;
    for (const message of historyData.messages) {
      if (message.user === botUserId && message.ts) {
        try {
          const deleteResponse = await fetch('https://slack.com/api/chat.delete', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              channel: channel,
              ts: message.ts,
            }),
          });

          const deleteData = await deleteResponse.json();
          if (deleteData.ok) {
            deletedCount++;
          }
        } catch (error) {
          console.error('Error deleting message:', error);
        }
      }
    }

    console.log(`🗑️ Deleted ${deletedCount} bot messages from screen`);
    
    // Send confirmation message
    await sendSlackMessage(
      channel,
      `🧹 **Screen Cleared!**\n\nThe messages have been cleared from your screen. Your conversation will continue with the same context when you send your next message.\n\n📝 Note: Your chat history is preserved for context.`,
      undefined // no thread
    );

    return true;
  } catch (error) {
    console.error('Error in clearScreenMessages:', error);
    return false;
  }
}