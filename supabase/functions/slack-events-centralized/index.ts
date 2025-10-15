// ============================================
// REFACTORED SLACK EVENTS EDGE FUNCTION
// Using Centralized Multi-Platform Schema
// ============================================

import { CentralizedDB } from '../_shared/centralized-database.ts';
import { generateGeminiResponse, generateReactionResponse } from '../_shared/gemini.ts';
import { sendSlackMessage, getSlackUserInfo, sendTypingIndicator, updateSlackMessage, getChannelInfo } from '../_shared/slack.ts';
import { isUserMuted } from '../_shared/slashCommands.ts';
import type { 
  SlackUserMetadata, 
  SlackConversationMetadata, 
  SlackMessageMetadata,
  UserQuery,
  BotResponse 
} from '../../../src/types/centralized-database.types.ts';

// ============================================
// EVENT PROCESSING CACHE
// ============================================

const processedEvents = new Set<string>();
const PROCESSING_TIMEOUT = 30000; // 30 seconds

// Clean up old processed events every 5 minutes
setInterval(() => {
  processedEvents.clear();
}, 5 * 60 * 1000);

// ============================================
// MAIN HANDLER
// ============================================

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.text();
    if (!body) return new Response('OK', { status: 200 });
    
    const eventData = JSON.parse(body);
    
    // Handle URL verification challenge
    if (eventData.type === 'url_verification') {
      return new Response(eventData.challenge, { 
        status: 200, 
        headers: { 'Content-Type': 'text/plain' } 
      });
    }
    
    // Handle event callbacks
    if (eventData.type === 'event_callback') {
      const event = eventData.event;
      const eventId = `${event.user || 'system'}-${event.ts}-${event.type}`;
      
      // Prevent duplicate processing
      if (processedEvents.has(eventId)) {
        console.log(`⏭️ Skipping duplicate event: ${eventId}`);
        return new Response('OK', { status: 200 });
      }
      
      processedEvents.add(eventId);
      
      // Process event asynchronously with timeout
      setTimeout(async () => {
        try {
          await processSlackEvent(event, eventData.team_id);
        } catch (error) {
          console.error('❌ Error processing Slack event:', error);
        } finally {
          // Clean up this event from cache after processing
          setTimeout(() => processedEvents.delete(eventId), 60000);
        }
      }, 50);
      
      return new Response('OK', { status: 200 });
    }
    
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('❌ Error in main handler:', error);
    return new Response('Error', { status: 500 });
  }
});

// ============================================
// EVENT PROCESSOR
// ============================================

async function processSlackEvent(event: any, teamId: string): Promise<void> {
  console.log(`🔄 Processing Slack event: ${event.type} from user ${event.user}`);
  
  try {
    switch (event.type) {
      case 'app_mention':
        await handleAppMention(event, teamId);
        break;
      case 'message':
        if (event.channel_type === 'im') {
          await handleDirectMessage(event, teamId);
        }
        break;
      case 'reaction_added':
        await handleReactionAdded(event, teamId);
        break;
      case 'reaction_removed':
        await handleReactionRemoved(event, teamId);
        break;
      default:
        console.log(`⏭️ Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error(`❌ Error processing ${event.type} event:`, error);
  }
}

// ============================================
// APP MENTION HANDLER
// ============================================

async function handleAppMention(event: any, teamId: string): Promise<void> {
  try {
    console.log('📢 Handling app mention:', { 
      user: event.user, 
      channel: event.channel, 
      thread_ts: event.thread_ts,
      team: teamId 
    });
    
    // Skip bot messages to prevent loops
    if (event.bot_id || event.subtype === 'bot_message') {
      console.log('⏭️ Skipping bot message');
      return;
    }

    // Check for file/media uploads and deny them
    if (hasFileUploads(event)) {
      console.log('⏭️ Denying mention with file uploads');
      await sendSlackMessage(
        event.channel, 
        '❌ Sorry, I can\'t process files or media. I can only handle text messages.',
        event.thread_ts
      );
      return;
    }

    // Get user information from Slack
    const userInfo = await getSlackUserInfo(event.user);
    if (!userInfo) {
      console.log('❌ Could not get user info');
      return;
    }

    // Create or get user in centralized database
    const userResult = await CentralizedDB.createSlackUser(event.user, userInfo, teamId);
    if (!userResult.success || !userResult.user) {
      console.error('❌ Could not create/get user:', userResult.error);
      return;
    }

    const user = userResult.user;
    console.log(`✅ User ready: ${user.id} (${user.display_name})`);

    // Check if user is muted
    if (isUserMuted(event.user)) {
      console.log('🔇 User is muted, ignoring message');
      return;
    }

    // Get channel information
    const channelInfo = await getChannelInfo(event.channel);
    
    // Create or get conversation
    const conversationResult = await CentralizedDB.createSlackConversation(
      user.id,
      event.channel,
      channelInfo || {},
      event.thread_ts
    );
    
    if (!conversationResult.success || !conversationResult.conversation) {
      console.error('❌ Could not create/get conversation:', conversationResult.error);
      return;
    }

    const conversation = conversationResult.conversation;
    console.log(`✅ Conversation ready: ${conversation.id}`);

    // Extract and clean message text
    const messageText = cleanSlackMessage(event.text) || 'Hello!';
    
    // Create platform metadata for the user query
    const queryMetadata: SlackMessageMetadata = {
      client_msg_id: event.client_msg_id,
      team: teamId,
      blocks: event.blocks,
      thread_ts: event.thread_ts,
      parent_user_id: event.parent_user_id,
      permalink: `https://slack.com/archives/${event.channel}/p${event.ts.replace('.', '')}`
    };

    // Save user query to database
    const queryResult = await CentralizedDB.saveUserQuery(
      conversation.id,
      user.id,
      messageText,
      event.ts,
      {
        hasAttachments: hasFileUploads(event),
        attachmentUrls: extractAttachmentUrls(event),
        messageType: 'text',
        platformMetadata: queryMetadata
      }
    );

    if (!queryResult.success || !queryResult.query) {
      console.error('❌ Could not save user query:', queryResult.error);
      return;
    }

    const query = queryResult.query;
    console.log(`✅ User query saved: ${query.id}`);

    // Send typing indicator
    console.log('💭 Sending typing indicator...');
    const typingMessage = await sendTypingIndicator(event.channel, event.thread_ts);
    
    // Generate AI response
    const startTime = Date.now();
    const aiResponse = await generateGeminiResponse(messageText, conversation.id, event.user);
    const processingTime = Date.now() - startTime;
    
    if (!aiResponse || !aiResponse.success) {
      console.error('❌ AI response failed:', aiResponse);
      await handleResponseError(query, conversation, event, typingMessage, 'AI response generation failed');
      return;
    }

    // Send response to Slack
    let finalMessageTs: string | undefined;
    
    if (typingMessage.ok && typingMessage.ts) {
      // Update typing message with actual response
      const updateResult = await updateSlackMessage(event.channel, typingMessage.ts, aiResponse.response);
      
      if (updateResult) {
        finalMessageTs = typingMessage.ts;
      } else {
        // If update failed, send new message
        const newMessage = await sendSlackMessage(event.channel, aiResponse.response, event.thread_ts);
        finalMessageTs = newMessage?.ts;
      }
    } else {
      // Send new message directly
      const newMessage = await sendSlackMessage(event.channel, aiResponse.response, event.thread_ts);
      finalMessageTs = newMessage?.ts;
    }

    // Save bot response to database
    const responseMetadata: SlackMessageMetadata = {
      team: teamId,
      thread_ts: event.thread_ts,
      permalink: finalMessageTs ? `https://slack.com/archives/${event.channel}/p${finalMessageTs.replace('.', '')}` : undefined
    };

    const responseResult = await CentralizedDB.saveBotResponse(
      query.id,
      conversation.id,
      aiResponse.response,
      {
        platformMessageId: finalMessageTs,
        modelUsed: aiResponse.model || 'gemini-2.0-flash',
        tokensUsed: aiResponse.tokens?.total,
        promptTokens: aiResponse.tokens?.prompt,
        completionTokens: aiResponse.tokens?.completion,
        processingTimeMs: processingTime,
        responseType: 'text',
        platformMetadata: responseMetadata
      }
    );

    if (responseResult.success) {
      console.log(`✅ Bot response saved: ${responseResult.response?.id}`);
    } else {
      console.error('❌ Could not save bot response:', responseResult.error);
    }

  } catch (error) {
    console.error('❌ Error in handleAppMention:', error);
  }
}

// ============================================
// DIRECT MESSAGE HANDLER
// ============================================

async function handleDirectMessage(event: any, teamId: string): Promise<void> {
  try {
    console.log('💬 Handling direct message:', { user: event.user, channel: event.channel });

    // Skip bot messages
    if (event.bot_id || event.subtype === 'bot_message') {
      console.log('⏭️ Skipping bot message');
      return;
    }

    // Check for file uploads
    if (hasFileUploads(event)) {
      console.log('⏭️ Denying DM with file uploads');
      await sendSlackMessage(
        event.channel, 
        '❌ Sorry, I can\'t process files or media. I can only handle text messages.'
      );
      return;
    }

    // Get user information
    const userInfo = await getSlackUserInfo(event.user);
    if (!userInfo) return;

    // Create or get user
    const userResult = await CentralizedDB.createSlackUser(event.user, userInfo, teamId);
    if (!userResult.success || !userResult.user) {
      console.error('❌ Could not create/get user for DM:', userResult.error);
      return;
    }

    const user = userResult.user;

    // Check if user is muted
    if (isUserMuted(event.user)) {
      console.log('🔇 User is muted, ignoring DM');
      return;
    }

    // Create DM conversation
    const conversationResult = await CentralizedDB.getOrCreateConversation(
      'slack',
      user.id,
      event.channel,
      undefined, // No thread in DM
      {
        channel_name: `DM with ${userInfo.name}`,
        is_dm: true,
        is_group_chat: false,
        platform_metadata: {
          team: teamId,
          channel_type: 'im'
        }
      }
    );

    if (!conversationResult.success || !conversationResult.conversation) {
      console.error('❌ Could not create/get DM conversation:', conversationResult.error);
      return;
    }

    const conversation = conversationResult.conversation;
    const messageText = event.text || 'Hello!';

    // Save user query
    const queryResult = await CentralizedDB.saveUserQuery(
      conversation.id,
      user.id,
      messageText,
      event.ts,
      {
        platformMetadata: {
          client_msg_id: event.client_msg_id,
          team: teamId
        }
      }
    );

    if (!queryResult.success || !queryResult.query) {
      console.error('❌ Could not save DM query:', queryResult.error);
      return;
    }

    // Process similar to app mention (typing indicator, AI response, etc.)
    const typingMessage = await sendTypingIndicator(event.channel);
    
    const startTime = Date.now();
    const aiResponse = await generateGeminiResponse(messageText, conversation.id, event.user);
    const processingTime = Date.now() - startTime;

    if (!aiResponse || !aiResponse.success) {
      await handleResponseError(queryResult.query, conversation, event, typingMessage, 'AI response generation failed');
      return;
    }

    // Send response
    let finalMessageTs: string | undefined;
    
    if (typingMessage.ok && typingMessage.ts) {
      const updateResult = await updateSlackMessage(event.channel, typingMessage.ts, aiResponse.response);
      finalMessageTs = updateResult ? typingMessage.ts : (await sendSlackMessage(event.channel, aiResponse.response))?.ts;
    } else {
      finalMessageTs = (await sendSlackMessage(event.channel, aiResponse.response))?.ts;
    }

    // Save bot response
    await CentralizedDB.saveBotResponse(
      queryResult.query.id,
      conversation.id,
      aiResponse.response,
      {
        platformMessageId: finalMessageTs,
        modelUsed: aiResponse.model || 'gemini-2.0-flash',
        tokensUsed: aiResponse.tokens?.total,
        promptTokens: aiResponse.tokens?.prompt,
        completionTokens: aiResponse.tokens?.completion,
        processingTimeMs: processingTime,
        platformMetadata: { team: teamId }
      }
    );

  } catch (error) {
    console.error('❌ Error in handleDirectMessage:', error);
  }
}

// ============================================
// REACTION HANDLERS
// ============================================

async function handleReactionAdded(event: any, teamId: string): Promise<void> {
  try {
    console.log('👍 Handling reaction added:', { 
      user: event.user, 
      reaction: event.reaction, 
      item_ts: event.item.ts 
    });

    // Skip system reactions
    if (event.user === 'USLACKBOT' || !event.user) {
      console.log('⏭️ Skipping system reaction');
      return;
    }

    // Get user info and create/get user
    const userInfo = await getSlackUserInfo(event.user);
    if (!userInfo) return;

    const userResult = await CentralizedDB.createSlackUser(event.user, userInfo, teamId);
    if (!userResult.success || !userResult.user) {
      console.error('❌ Could not get user for reaction:', userResult.error);
      return;
    }

    // Find the bot response by platform message ID
    const responseResult = await CentralizedDB.findBotResponseByPlatformMessageId(event.item.ts);
    if (!responseResult.success || !responseResult.response) {
      console.log('❌ Could not find bot response for reaction');
      return;
    }

    // Add reaction to database
    const reactionResult = await CentralizedDB.addMessageReaction(
      responseResult.response.id,
      userResult.user.id,
      event.reaction,
      'slack',
      getEmojiUnicode(event.reaction)
    );

    if (reactionResult.success) {
      console.log('✅ Reaction added to database');
      
      // Generate sentiment-based response
      const reactionResponse = await generateReactionResponse(event.reaction);
      
      if (reactionResponse.success) {
        await sendSlackMessage(event.item.channel, reactionResponse.response);
        console.log('💬 Sent reaction response');
      }
    }

  } catch (error) {
    console.error('❌ Error in handleReactionAdded:', error);
  }
}

async function handleReactionRemoved(event: any, teamId: string): Promise<void> {
  try {
    console.log('👎 Handling reaction removed:', { 
      user: event.user, 
      reaction: event.reaction, 
      item_ts: event.item.ts 
    });

    // Skip system reactions
    if (event.user === 'USLACKBOT' || !event.user) {
      console.log('⏭️ Skipping system reaction removal');
      return;
    }

    // Get user
    const userResult = await CentralizedDB.getUser('slack', event.user);
    if (!userResult.success || !userResult.user) {
      console.log('❌ Could not find user for reaction removal');
      return;
    }

    // Find bot response
    const responseResult = await CentralizedDB.findBotResponseByPlatformMessageId(event.item.ts);
    if (!responseResult.success || !responseResult.response) {
      console.log('❌ Could not find bot response for reaction removal');
      return;
    }

    // Remove reaction from database
    const removalResult = await CentralizedDB.removeMessageReaction(
      responseResult.response.id,
      userResult.user.id,
      event.reaction
    );

    if (removalResult.success) {
      console.log('✅ Reaction removed from database');
    }

  } catch (error) {
    console.error('❌ Error in handleReactionRemoved:', error);
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if event contains file uploads
 */
function hasFileUploads(event: any): boolean {
  return !!(
    (event.files && event.files.length > 0) ||
    (event.attachments && event.attachments.length > 0) ||
    (event.subtype && ['file_share', 'bot_message'].includes(event.subtype)) ||
    (event.text && event.text.includes('uploaded a file'))
  );
}

/**
 * Extract attachment URLs from event
 */
function extractAttachmentUrls(event: any): string[] {
  const urls: string[] = [];
  
  if (event.files) {
    urls.push(...event.files.map((file: any) => file.url_private).filter(Boolean));
  }
  
  if (event.attachments) {
    urls.push(...event.attachments.map((att: any) => att.image_url || att.thumb_url).filter(Boolean));
  }
  
  return urls;
}

/**
 * Clean Slack message text (remove mentions, etc.)
 */
function cleanSlackMessage(text: string): string {
  if (!text) return '';
  
  return text
    .replace(/<@[A-Z0-9]+>/g, '') // Remove user mentions
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1') // Convert channel mentions
    .replace(/<([^>]+)>/g, '$1') // Remove other formatting
    .trim();
}

/**
 * Get emoji unicode (placeholder implementation)
 */
function getEmojiUnicode(emojiName: string): string | undefined {
  // This would need a proper emoji mapping
  // For now, return undefined and let the database handle it
  return undefined;
}

/**
 * Handle response errors
 */
async function handleResponseError(
  query: UserQuery,
  conversation: any,
  event: any,
  typingMessage: any,
  errorMessage: string
): Promise<void> {
  console.error('⚠️ Handling response error:', errorMessage);
  
  const errorResponse = "Sorry, I encountered an error while processing your message. Please try again.";
  
  // Send error message to user
  if (typingMessage.ok && typingMessage.ts) {
    await updateSlackMessage(event.channel, typingMessage.ts, errorResponse);
  } else {
    await sendSlackMessage(event.channel, errorResponse, event.thread_ts);
  }
  
  // Save error response to database
  await CentralizedDB.saveBotResponse(
    query.id,
    conversation.id,
    errorResponse,
    {},
    {
      errorMessage,
      errorCode: 'AI_GENERATION_FAILED',
      retryCount: 0
    }
  );
}

// ============================================
// EXPORT FOR TESTING
// ============================================

export {
  processSlackEvent,
  handleAppMention,
  handleDirectMessage,
  handleReactionAdded,
  handleReactionRemoved
};