import { App, ExpressReceiver, SayFn, KnownEventFromType, Logger } from '@slack/bolt';
import { NextRequest, NextResponse } from 'next/server';
import { 
  getOrCreateUser, 
  getOrCreateConversation, 
  createUserQuery,
  createBotResponse,
  getConversationHistory,
  updateConversationTitle,
  addMessageReaction,
  removeMessageReaction,
  getBotResponseBySlackTs
} from '@/lib/database';
import { 
  clearConversation,
  createNewConversationForUser,
  deleteConversationData,
  getConversationStats,
  muteUser,
  unmuteUser,
  isUserMuted
} from '@/lib/slashCommands';
import { generateGeminiResponse, generateConversationTitle, isGeminiInitialized } from '@/lib/gemini';
import { getSlackUserInfo, updateSlackMessage } from '@/lib/slack';

// Initialize the Bolt app without ExpressReceiver for Next.js
const app = new App({
  token: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  processBeforeResponse: true,
});

// Track processed events to avoid duplicates (Slack retries)
const processedEvents = new Map<string, number>(); // Store with timestamp
const processingEvents = new Set<string>(); // Track currently processing events
const userProcessingLocks = new Set<string>(); // Global user processing locks
const EVENT_CACHE_TTL = 300000; // 5 minutes

// Clean up old events from cache every minute (but keep recent ones)
setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];
  
  // Only remove events older than 5 minutes
  processedEvents.forEach((timestamp, key) => {
    if (now - timestamp > EVENT_CACHE_TTL) {
      keysToDelete.push(key);
    }
  });
  
  keysToDelete.forEach(key => processedEvents.delete(key));
  
  console.log(`🧹 Cache cleanup: Removed ${keysToDelete.length} old events, ${processedEvents.size} events remaining`);
}, 60000); // Clean every minute

// Listen for app mentions - when someone @mentions the bot
app.event('app_mention', async ({ event, say, logger }: { 
  event: KnownEventFromType<'app_mention'>, 
  say: SayFn, 
  logger: Logger 
}) => {
  logger.info(`📨 Received app_mention from user: ${event.user}, event_ts: ${event.ts}`);
  
  // 🔍 DEBUG: Log the full event structure to understand what Slack sends with image uploads
  logger.info(`🔍 FULL EVENT STRUCTURE:`, JSON.stringify(event, null, 2));

  // Check for duplicate events using multiple identifiers for better detection
  const eventKey1 = (event as any).client_msg_id;
  const eventKey2 = `${event.user}-${event.ts}`;
  const eventKey3 = `${event.channel}-${event.ts}`;
  
  logger.info(`🔍 Checking duplicates - client_msg_id: ${eventKey1}, user-ts: ${eventKey2}, channel-ts: ${eventKey3}`);
  logger.info(`📊 Processed events count: ${processedEvents.size}, Processing events count: ${processingEvents.size}`);
  
  // Check all possible duplicate identifiers (both processed and currently processing)
  if (eventKey1 && (processedEvents.has(eventKey1) || processingEvents.has(eventKey1))) {
    logger.info(`⏭️ Skipping - duplicate mention event (client_msg_id): ${eventKey1}`);
    return;
  }
  if (processedEvents.has(eventKey2) || processingEvents.has(eventKey2)) {
    logger.info(`⏭️ Skipping - duplicate mention event (user-ts): ${eventKey2}`);
    return;
  }
  if (processedEvents.has(eventKey3) || processingEvents.has(eventKey3)) {
    logger.info(`⏭️ Skipping - duplicate mention event (channel-ts): ${eventKey3}`);
    return;
  }
  
  // Additional safeguard: Check if user is already being processed
  const userLockKey = `${event.user}-${event.channel}`;
  if (userProcessingLocks.has(userLockKey)) {
    logger.info(`🔒 User is already being processed in this channel: ${userLockKey}`);
    return;
  }

  logger.info(`✅ Event is unique, processing: ${eventKey2}`);
  
  // Mark as currently processing
  userProcessingLocks.add(userLockKey);
  if (eventKey1) processingEvents.add(eventKey1);
  processingEvents.add(eventKey2);
  processingEvents.add(eventKey3);

  try {
    // Extract the user's message (remove the bot mention)
    const userPrompt = event.text.replace(/<@.*?>/, '').trim();
    const slackUserId = event.user || '';
    const slackChannelId = event.channel;
    // For app_mentions, only use thread_ts if the original message was already in a thread
    // This prevents creating threads for regular channel mentions
    const slackThreadTs = event.thread_ts; // Don't default to event.ts

    if (!slackUserId) {
      logger.error('Missing user ID in event');
      return;
    }

    // Check if user is muted
    if (isUserMuted(slackUserId)) {
      logger.info(`🔇 User ${slackUserId} is muted - not responding to mention`);
      return;
    }

    // Ignore messages with file uploads - we only accept text
    // Check multiple ways Slack can send files/media
    const hasFiles = (event as any).files && (event as any).files.length > 0;
    const hasAttachments = (event as any).attachments && (event as any).attachments.length > 0;
    const hasSubtype = (event as any).subtype && ['file_share', 'bot_message'].includes((event as any).subtype);
    const hasUpload = event.text && event.text.includes('uploaded a file');
    
    logger.info(`🔍 File detection - files: ${hasFiles}, attachments: ${hasAttachments}, subtype: ${(event as any).subtype}, hasUpload: ${hasUpload}`);
    logger.info(`🔍 Full event data:`, JSON.stringify(event, null, 2));
    
    if (hasFiles || hasAttachments || hasSubtype || hasUpload) {
      logger.info(`⏭️ Skipping mention - contains file/media uploads (we only accept text)`);
      await say({
        text: '❌ Sorry, I can\'t access files or media. I can only process text messages.',
        ...(slackThreadTs && { thread_ts: slackThreadTs })
      });
      return;
    }

    // Ignore if no meaningful text (after removing mention)
    if (!userPrompt || userPrompt.trim() === '') {
      logger.info(`⏭️ Skipping mention - no text content`);
      await say({
        text: '👋 Hi! Please include a message with your mention.',
        ...(slackThreadTs && { thread_ts: slackThreadTs })
      });
      return;
    }

    // Send "thinking" message
    const thinkingMessage = await say({
      text: '🤔 Thinking...',
      ...(slackThreadTs && { thread_ts: slackThreadTs })
    });

    // Check if Gemini is initialized
    if (!isGeminiInitialized()) {
      await updateSlackMessage(
        thinkingMessage.channel!,
        thinkingMessage.ts!,
        "❌ I'm sorry, my AI connection is not configured. Please contact the administrator."
      );
      return;
    }

    // Get or create user in database
    const userInfo = await getSlackUserInfo(slackUserId);
    const user = await getOrCreateUser(slackUserId, userInfo || undefined);
    
    if (!user) {
      logger.error('Failed to create/fetch user');
      await updateSlackMessage(
        thinkingMessage.channel!,
        thinkingMessage.ts!,
        "❌ Sorry, I encountered a database error. Please try again."
      );
      return;
    }

    // Get or create conversation
    const conversation = await getOrCreateConversation(
      user.id,
      slackChannelId,
      slackThreadTs !== event.ts ? slackThreadTs : undefined
    );

    if (!conversation) {
      logger.error('Failed to create/fetch conversation');
      await updateSlackMessage(
        thinkingMessage.channel!,
        thinkingMessage.ts!,
        "❌ Sorry, I encountered a database error. Please try again."
      );
      return;
    }

    // Save user query to database
    const userQuery = await createUserQuery(
      conversation.id,
      userPrompt,
      event.ts
    );

    if (!userQuery) {
      logger.error('Failed to save user query');
    }

    // Get conversation history for context
    const history = await getConversationHistory(conversation.id, 20); // Increased to 20 for more context
    logger.info(`📚 Retrieved ${history.length} messages from conversation history for conversation ${conversation.id}`);
    
    if (history.length > 0) {
      logger.info(`📖 Last message in history: Role=${history[history.length - 1]?.role}, Content preview="${history[history.length - 1]?.content?.substring(0, 100)}..."`);
    } else {
      logger.info(`📭 No conversation history found - this appears to be the first message`);
    }
    
    // Pass full history with reactions to Gemini for emotional context
    const conversationContext = history.map(msg => ({
      role: msg.role,
      content: msg.content,
      reactions: msg.reactions,
      reactionContext: msg.reactionContext
    }));

    logger.info(`🧠 Sending ${conversationContext.length} context messages to Gemini`);

    // Generate response from Gemini
    const geminiResult = await generateGeminiResponse(
      userPrompt,
      conversationContext,
      'gemini-2.0-flash'
    );

    if (geminiResult.error || !geminiResult.text) {
      logger.error('Gemini error:', geminiResult.error);
      await updateSlackMessage(
        thinkingMessage.channel!,
        thinkingMessage.ts!,
        `❌ Sorry, I encountered an error: ${geminiResult.error || 'Unknown error'}`
      );
      
      // Save error response to database (if we have a query)
      if (userQuery) {
        await createBotResponse({
          query_id: userQuery.id,
          content: '',
          error_message: geminiResult.error,
          processing_time_ms: geminiResult.processingTime
        });
      }
    } else {
      // Save bot response to database
      if (userQuery) {
        await createBotResponse({
          query_id: userQuery.id,
          content: geminiResult.text,
          slack_message_ts: thinkingMessage.ts,
          tokens_used: geminiResult.tokensUsed,
          model_used: 'gemini-2.0-flash',
          processing_time_ms: geminiResult.processingTime
        });
      }

      // Update the thinking message with the actual response
      const updateResult = await updateSlackMessage(
        thinkingMessage.channel!,
        thinkingMessage.ts!,
        geminiResult.text
      );

      if (!updateResult) {
        logger.error('⚠️ Failed to update message - check if response is too long');
        logger.info(`📏 Response length: ${geminiResult.text.length} characters`);
      }

      // Generate and save conversation title if this is the first message
      if (history.length === 0 && !conversation.conversation_title) {
        const title = await generateConversationTitle(userPrompt);
        await updateConversationTitle(conversation.id, title);
      }

      logger.info(`✅ Response sent successfully (${geminiResult.processingTime}ms)`);
    }

  } catch (error) {
    logger.error('❌ Error handling app_mention:', error);
    await say({
      text: '❌ I encountered an unexpected error. Please try again or contact support.',
      ...(event.thread_ts && { thread_ts: event.thread_ts})
    });
  } finally {
    // Mark event as completed and remove from processing set
    const eventKey1 = (event as any).client_msg_id;
    const eventKey2 = `${event.user}-${event.ts}`;
    const eventKey3 = `${event.channel}-${event.ts}`;
    const userLockKey = `${event.user}-${event.channel}`;
    
    // Release user processing lock
    userProcessingLocks.delete(userLockKey);
    
    // Move from processing to processed
    const now = Date.now();
    if (eventKey1) {
      processingEvents.delete(eventKey1);
      processedEvents.set(eventKey1, now);
    }
    processingEvents.delete(eventKey2);
    processedEvents.set(eventKey2, now);
    processingEvents.delete(eventKey3);
    processedEvents.set(eventKey3, now);
    
    logger.info(`🏁 Event processing completed for: ${eventKey2}`);
  }
});

// Listen for direct messages to the bot
app.event('message', async ({ event, say, logger }: any) => {
  // Debug: Log all message events
  logger.info(`🔍 Message event received - channel_type: ${event.channel_type}, subtype: ${event.subtype}, has_text: ${!!event.text}, event_ts: ${event.event_ts}`);
  
  // ⚠️ CRITICAL: Check for duplicates FIRST before doing anything else
  // This prevents multiple responses to the same event
  const eventKey1 = event.client_msg_id;
  const eventKey2 = `dm-${event.user}-${event.ts}`;
  
  // Check all possible duplicate identifiers (both processed and currently processing)
  if (eventKey1 && (processedEvents.has(eventKey1) || processingEvents.has(eventKey1))) {
    logger.info(`⏭️ Skipping - duplicate DM event (client_msg_id): ${eventKey1}`);
    return;
  }
  if (processedEvents.has(eventKey2) || processingEvents.has(eventKey2)) {
    logger.info(`⏭️ Skipping - duplicate DM event (user-ts): ${eventKey2}`);
    return;
  }
  
  // Additional safeguard: Check if user is already being processed in DMs
  const userLockKey = `dm-${event.user}`;
  if (userProcessingLocks.has(userLockKey)) {
    logger.info(`🔒 User DM is already being processed: ${userLockKey}`);
    return;
  }
  
  // Mark as currently processing
  userProcessingLocks.add(userLockKey);
  if (eventKey1) processingEvents.add(eventKey1);
  processingEvents.add(eventKey2);
  
  // Only handle direct messages (not channel messages)
  if (event.channel_type !== 'im') {
    logger.info(`⏭️ Skipping - not a DM (channel_type: ${event.channel_type})`);
    return;
  }

  // Ignore bot messages and message changes/deletions
  if (event.subtype === 'bot_message' || event.subtype === 'message_changed' || event.subtype === 'message_deleted') {
    logger.info(`⏭️ Skipping - bot message or change (subtype: ${event.subtype})`);
    return;
  }

  // Ignore if there's a bot_id (this message is from a bot)
  if (event.bot_id) {
    logger.info(`⏭️ Skipping - message has bot_id: ${event.bot_id}`);
    return;
  }

  // ⚠️ IMPORTANT: Check for file uploads FIRST (before text check)
  // This rejects images/files even if they have text captions
  if (event.files && event.files.length > 0) {
    logger.info(`⏭️ Rejecting - message contains file uploads (we only accept text)`);
    await say('❌ Sorry, I can only process text messages. File uploads, images, videos, and audio are not supported. Please send text only.');
    return;
  }

  // Ignore messages with attachments
  if (event.attachments && event.attachments.length > 0) {
    logger.info(`⏭️ Rejecting - message contains attachments`);
    await say('❌ Sorry, I can only process text messages. Attachments are not supported.');
    return;
  }

  // Ignore if there's no text (like file uploads without text)
  if (!event.text || event.text.trim() === '') {
    logger.info(`⏭️ Skipping - no text`);
    return;
  }

  // Check if user is muted
  if (isUserMuted(event.user)) {
    logger.info(`🔇 User ${event.user} is muted - not responding`);
    return;
  }

  logger.info(`✅ Processing DM from user: ${event.user}`);
  logger.info(`📝 Message text: ${event.text}`);

  try {
    const userPrompt = event.text.trim();
    const slackUserId = event.user || '';
    const slackChannelId = event.channel;

    if (!slackUserId) {
      logger.error('Missing user ID in DM event');
      return;
    }

    // Send "thinking" message
    const thinkingMessage = await say('🤔 Thinking...');

    // Check if Gemini is initialized
    if (!isGeminiInitialized()) {
      await updateSlackMessage(
        thinkingMessage.channel!,
        thinkingMessage.ts!,
        "❌ I'm sorry, my AI connection is not configured. Please contact the administrator."
      );
      return;
    }

    // Get or create user in database
    const userInfo = await getSlackUserInfo(slackUserId);
    const user = await getOrCreateUser(slackUserId, userInfo || undefined);
    
    if (!user) {
      logger.error('Failed to create/fetch user');
      await updateSlackMessage(
        thinkingMessage.channel!,
        thinkingMessage.ts!,
        "❌ Sorry, I encountered a database error. Please try again."
      );
      return;
    }

    // Get or create conversation
    const conversation = await getOrCreateConversation(user.id, slackChannelId);

    if (!conversation) {
      logger.error('Failed to create/fetch conversation');
      await updateSlackMessage(
        thinkingMessage.channel!,
        thinkingMessage.ts!,
        "❌ Sorry, I encountered a database error. Please try again."
      );
      return;
    }

    // Save user query
    const userQuery = await createUserQuery(
      conversation.id,
      userPrompt,
      event.ts
    );

    // Get conversation history
    const history = await getConversationHistory(conversation.id, 5);
    
    // Pass full history with reactions to Gemini for emotional context
    const conversationContext = history.map(msg => ({
      role: msg.role,
      content: msg.content,
      reactions: msg.reactions,
      reactionContext: msg.reactionContext
    }));

    // Generate response from Gemini
    const geminiResult = await generateGeminiResponse(
      userPrompt,
      conversationContext,
      'gemini-2.0-flash'
    );

    if (geminiResult.error || !geminiResult.text) {
      logger.error('Gemini error:', geminiResult.error);
      await updateSlackMessage(
        thinkingMessage.channel!,
        thinkingMessage.ts!,
        `❌ Sorry, I encountered an error: ${geminiResult.error || 'Unknown error'}`
      );
      
      if (userQuery) {
        await createBotResponse({
          query_id: userQuery.id,
          content: '',
          error_message: geminiResult.error,
          processing_time_ms: geminiResult.processingTime
        });
      }
    } else {
      // Save bot response
      if (userQuery) {
        await createBotResponse({
          query_id: userQuery.id,
          content: geminiResult.text,
          slack_message_ts: thinkingMessage.ts,
          tokens_used: geminiResult.tokensUsed,
          model_used: 'gemini-2.0-flash',
          processing_time_ms: geminiResult.processingTime
        });
      }

      // Update message with response
      const updateResult = await updateSlackMessage(
        thinkingMessage.channel!,
        thinkingMessage.ts!,
        geminiResult.text
      );

      if (!updateResult) {
        logger.error('⚠️ Failed to update message - check if response is too long');
        logger.info(`📏 Response length: ${geminiResult.text.length} characters`);
      }

      // Generate title if first message
      if (history.length === 0 && !conversation.conversation_title) {
        const title = await generateConversationTitle(userPrompt);
        await updateConversationTitle(conversation.id, title);
      }

      logger.info(`✅ DM Response sent successfully (${geminiResult.processingTime}ms)`);
    }

  } catch (error) {
    logger.error('❌ Error handling DM:', error);
    await say('❌ I encountered an unexpected error. Please try again or contact support.');
  } finally {
    // Mark event as completed and remove from processing set
    const eventKey1 = event.client_msg_id;
    const eventKey2 = `dm-${event.user}-${event.ts}`;
    const userLockKey = `dm-${event.user}`;
    
    // Release user processing lock
    userProcessingLocks.delete(userLockKey);
    
    // Move from processing to processed
    const now = Date.now();
    if (eventKey1) {
      processingEvents.delete(eventKey1);
      processedEvents.set(eventKey1, now);
    }
    processingEvents.delete(eventKey2);
    processedEvents.set(eventKey2, now);
    
    logger.info(`🏁 DM Event processing completed for: ${eventKey2}`);
  }
});

/**
 * REACTION EVENT HANDLERS
 * Track emoji reactions on bot responses for sentiment analysis
 */

// Listen for reaction_added events
app.event('reaction_added', async ({ event, logger }: { event: any, logger: Logger }) => {
  try {
    logger.info(`👍 Reaction added: ${event.reaction} by user ${event.user} on message ${event.item.ts}`);
    
    // Only track reactions on messages (not files or other items)
    if (event.item.type !== 'message') {
      logger.info('⏭️ Skipping - reaction not on a message');
      return;
    }

    const messageTs = event.item.ts;
    const reactionName = event.reaction;
    const userId = event.user;

    // Find the bot response by slack message timestamp
    const botResponse = await getBotResponseBySlackTs(messageTs);
    
    if (!botResponse) {
      logger.info('⏭️ Skipping - reaction not on a bot response');
      return;
    }

    // Save the reaction to database
    const success = await addMessageReaction(botResponse.id, userId, reactionName);
    
    if (success) {
      logger.info(`✅ Saved reaction: ${reactionName} on response ${botResponse.id}`);
    } else {
      logger.error(`❌ Failed to save reaction: ${reactionName}`);
    }

  } catch (error) {
    logger.error('❌ Error handling reaction_added:', error);
  }
});

// Listen for reaction_removed events
app.event('reaction_removed', async ({ event, logger }: { event: any, logger: Logger }) => {
  try {
    logger.info(`👎 Reaction removed: ${event.reaction} by user ${event.user} on message ${event.item.ts}`);
    
    // Only track reactions on messages
    if (event.item.type !== 'message') {
      logger.info('⏭️ Skipping - reaction not on a message');
      return;
    }

    const messageTs = event.item.ts;
    const reactionName = event.reaction;
    const userId = event.user;

    // Find the bot response by slack message timestamp
    const botResponse = await getBotResponseBySlackTs(messageTs);
    
    if (!botResponse) {
      logger.info('⏭️ Skipping - reaction not on a bot response');
      return;
    }

    // Remove the reaction from database
    const success = await removeMessageReaction(botResponse.id, userId, reactionName);
    
    if (success) {
      logger.info(`✅ Removed reaction: ${reactionName} from response ${botResponse.id}`);
    } else {
      logger.error(`❌ Failed to remove reaction: ${reactionName}`);
    }

  } catch (error) {
    logger.error('❌ Error handling reaction_removed:', error);
  }
});

/**
 * SLASH COMMAND HANDLERS
 */

// /clear - Clear conversation history (soft delete)
app.command('/clear', async ({ command, ack, respond, logger }: any) => {
  await ack();
  
  try {
    const slackUserId = command.user_id;
    const slackChannelId = command.channel_id;
    
    // Get user and conversation
    const user = await getOrCreateUser(slackUserId);
    if (!user) {
      await respond('❌ Error finding your user account.');
      return;
    }
    
    const conversation = await getOrCreateConversation(user.id, slackChannelId);
    if (!conversation) {
      await respond('❌ No conversation found.');
      return;
    }
    
    // Get conversation stats
    const stats = await getConversationStats(conversation.id);
    if (!stats || stats.messageCount === 0) {
      await respond('ℹ️ No messages to clear. Your chat is already empty!');
      return;
    }
    
    // Clear the conversation
    const success = await clearConversation(conversation.id);
    
    if (success) {
      await respond(`✅ **Chat Cleared!**
      
📊 **What was cleared:**
• ${stats.messageCount} messages
• ${stats.responseCount} responses  
• ${stats.reactionCount} reactions

💾 **Note:** Data is preserved in the database, but your chat history is reset. You can start fresh now!`);
      logger.info(`✅ User ${slackUserId} cleared conversation ${conversation.id}`);
    } else {
      await respond('❌ Failed to clear chat. Please try again.');
    }
  } catch (error) {
    logger.error('❌ Error in /clear command:', error);
    await respond('❌ An error occurred while clearing the chat.');
  }
});

// /new-chat - Create new conversation
app.command('/new-chat', async ({ command, ack, respond, logger }: any) => {
  await ack();
  
  try {
    const slackUserId = command.user_id;
    const slackChannelId = command.channel_id;
    
    // Get user
    const user = await getOrCreateUser(slackUserId);
    if (!user) {
      await respond('❌ Error finding your user account.');
      return;
    }
    
    // Create new conversation
    const newConversationId = await createNewConversationForUser(user.id, slackChannelId);
    
    if (newConversationId) {
      await respond(`🆕 **New Chat Started!**

✨ You now have a fresh conversation. Previous chats are still saved - you can use:
• \`/clear\` - Reset current chat (keeps data)
• \`/delete\` - Permanently delete chat data
• \`/mute\` - Pause bot responses

🚀 Ready for your first message!`);
      logger.info(`✅ User ${slackUserId} created new conversation ${newConversationId}`);
    } else {
      await respond('❌ Failed to create new chat. Please try again.');
    }
  } catch (error) {
    logger.error('❌ Error in /new command:', error);
    await respond('❌ An error occurred while creating a new chat.');
  }
});

// /delete - Permanently delete conversation data
app.command('/delete', async ({ command, ack, respond, logger }: any) => {
  await ack();
  
  try {
    const slackUserId = command.user_id;
    const slackChannelId = command.channel_id;
    
    // Get user and conversation
    const user = await getOrCreateUser(slackUserId);
    if (!user) {
      await respond('❌ Error finding your user account.');
      return;
    }
    
    const conversation = await getOrCreateConversation(user.id, slackChannelId);
    if (!conversation) {
      await respond('❌ No conversation found.');
      return;
    }
    
    // Get conversation stats
    const stats = await getConversationStats(conversation.id);
    if (!stats || stats.messageCount === 0) {
      await respond('ℹ️ No data to delete. Your chat is already empty!');
      return;
    }
    
    // Show confirmation message
    await respond(`⚠️ **DELETE CONFIRMATION REQUIRED**

📊 **Data to be permanently deleted:**
• ${stats.messageCount} messages
• ${stats.responseCount} bot responses
• ${stats.reactionCount} reactions

🚨 **THIS ACTION CANNOT BE UNDONE!**

To confirm deletion, type: \`/delete confirm\``);
    
    // Check if user provided confirmation
    const confirmText = command.text?.trim().toLowerCase();
    if (confirmText === 'confirm') {
      // Delete all data
      const success = await deleteConversationData(conversation.id);
      
      if (success) {
        await respond(`✅ **All Data Deleted Successfully!**

🗑️ **Permanently removed:**
• All your messages and my responses
• All reactions and conversation history
• Complete conversation record

🆕 Your next message will start a fresh conversation.`);
        logger.info(`✅ User ${slackUserId} deleted conversation ${conversation.id} completely`);
      } else {
        await respond('❌ Failed to delete data. Please try again or contact support.');
      }
    }
  } catch (error) {
    logger.error('❌ Error in /delete command:', error);
    await respond('❌ An error occurred while processing delete request.');
  }
});

// /mute - Mute/unmute bot responses  
app.command('/mute', async ({ command, ack, respond, logger }: any) => {
  await ack();
  
  try {
    const slackUserId = command.user_id;
    const action = command.text?.trim().toLowerCase();
    
    if (action === 'off' || action === 'unmute') {
      // Unmute user
      const wasUnmuted = unmuteUser(slackUserId);
      if (wasUnmuted) {
        await respond(`🔊 **Bot Unmuted!**

✅ I will now respond to your messages again.
📝 Send me a message to test!`);
      } else {
        await respond('ℹ️ Bot was not muted. I\'m already responding to your messages!');
      }
      logger.info(`✅ User ${slackUserId} unmuted bot`);
    } else {
      // Mute user (default action)
      muteUser(slackUserId);
      await respond(`🔇 **Bot Muted!**

😴 I will not respond to your messages until you unmute me.

🔊 **To unmute:** \`/mute off\` or \`/mute unmute\``);
      logger.info(`✅ User ${slackUserId} muted bot`);
    }
  } catch (error) {
    logger.error('❌ Error in /mute command:', error);
    await respond('❌ An error occurred while processing mute request.');
  }
});

// This is the Next.js API route handler
async function handler(req: NextRequest) {
  try {
    console.log('🔍 Incoming request to /api/slack/events');
    console.log('🔍 Request method:', req.method);
    
    // Get the raw body as text
    const rawBody = await req.text();
    console.log('🔍 Request body length:', rawBody.length);
    
    // Return empty response if body is empty (handles retries)
    if (!rawBody || rawBody.trim() === '') {
      console.log('⚠️ Empty request body, returning 200');
      return new NextResponse(null, { status: 200 });
    }

    // Try to parse as JSON first
    let parsedBody;
    try {
      parsedBody = JSON.parse(rawBody);
      
      // Handle Slack's URL verification challenge
      if (parsedBody.challenge) {
        console.log('✅ Responding to URL verification challenge');
        return new NextResponse(parsedBody.challenge, { 
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    } catch {
      // If not JSON, parse as form data (slash commands)
      console.log('📝 Parsing as URL-encoded form data');
      const params = new URLSearchParams(rawBody);
      parsedBody = Object.fromEntries(params.entries());
      console.log('⚡ Parsed slash command:', parsedBody.command);
    }

    // Log what we received
    if (parsedBody.command) {
      console.log(`⚡ Received slash command: ${parsedBody.command}`);
      console.log(`👤 User: ${parsedBody.user_id}`);
      console.log(`📱 Channel: ${parsedBody.channel_id}`);
    } else if (parsedBody.event) {
      console.log(`📨 Received event: ${parsedBody.event.type}`);
    }

    // Create headers object for Bolt
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Variable to capture acknowledgment response
    let ackResponse: any = null;

    // Process with Bolt
    await app.processEvent({
      body: parsedBody,
      ack: async (response: any) => {
        console.log('✅ Command acknowledged');
        ackResponse = response;
      },
    });

    // Return acknowledgment if we have one, otherwise just 200
    if (ackResponse) {
      return new NextResponse(
        typeof ackResponse === 'string' ? ackResponse : JSON.stringify(ackResponse),
        { status: 200 }
      );
    }

    return new NextResponse(null, { status: 200 });

  } catch (error) {
    console.error('❌ Error in handler:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

// Export the handler for POST requests as required by Next.js App Router
export { handler as POST };
