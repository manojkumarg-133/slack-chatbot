﻿﻿﻿﻿// Slack Events Edge Function for Supabase with Centralized Database
import { CentralizedDB } from '../_shared/centralized-database.ts';
import { generateGeminiResponse, generateConversationTitle } from '../_shared/gemini.ts';
import { sendSlackMessage, sendTypingIndicator, updateSlackMessage } from '../_shared/slack.ts';

// Helper function to process Slack messages (both regular messages and app mentions)
async function processSlackMessage(
  userId: string,
  channelId: string,
  messageText: string,
  messageTs: string,
  threadTs: string | undefined
) {
  try {
    console.log('👤 Upserting user: slack:' + userId);
    
    // Upsert user in centralized database
    const userResult = await CentralizedDB.upsertUser('slack', userId);
    if (!userResult.success || !userResult.user) {
      console.error('❌ Failed to upsert user:', userResult.error);
      return;
    }
    console.log('✅ User upserted successfully:', userResult.user.id);

    // Get or create conversation
    console.log(`🔍 Looking for conversation - Platform: slack, User: ${userResult.user.id}, Channel: ${channelId}, Thread: ${threadTs || 'none'}`);
    const conversationResult = await CentralizedDB.getOrCreateConversation('slack', userResult.user.id, channelId, threadTs);
    if (!conversationResult.success || !conversationResult.conversation) {
      console.error('❌ Failed to get/create conversation:', conversationResult.error);
      return;
    }

    const conversation = conversationResult.conversation;
    console.log('🔄 Processing conversation:', conversation.id);

    // Add user query to database
    const queryResult = await CentralizedDB.saveUserQuery(
      conversation.id,
      userResult.user.id,
      messageText,
      messageTs,
      { platformMetadata: { channelId, threadTs } }
    );

    if (!queryResult.success || !queryResult.query) {
      console.error('❌ Failed to add user query:', queryResult.error);
      return;
    }

    console.log('📝 User query added to database');

    // Send initial "generating" message that we'll update later (no separate typing indicator)
    const statusMessage = await sendSlackMessage(channelId, "⚡ Generating response...", threadTs);
    let statusMessageTs = statusMessage && typeof statusMessage === 'object' ? statusMessage.ts : null;
    console.log('📤 Sent status message with ts:', statusMessageTs);

    // Get conversation history for context
    const historyResult = await CentralizedDB.getConversationHistory(conversation.id, 10);
    let conversationContext = '';
    
    if (historyResult.success && historyResult.messages && historyResult.messages.length > 0) {
      conversationContext = historyResult.messages
        .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
        .join('\n');
      console.log('📚 Retrieved conversation context with', historyResult.messages.length, 'previous messages');
    }

    // Generate AI response with context
    const fullPrompt = conversationContext 
      ? `Previous conversation:\n${conversationContext}\n\nUser: ${messageText}`
      : messageText;

    console.log('🤖 Generating AI response...');
    // Pass the current message for proper language detection
    const aiResponse = await generateGeminiResponse(fullPrompt, conversation.id, userId, 'gemini-2.5-flash', messageText);
    
    if (!aiResponse.success || !aiResponse.response || aiResponse.response.trim() === '') {
      console.error('❌ Empty AI response received:', aiResponse.error);
      return;
    }

    console.log('✅ AI response generated, updating status message...');

    // Update the status message with the actual response
    let slackResponse;
    let responseTs;
    
    if (statusMessageTs) {
      console.log('🔄 Attempting to update existing message with ts:', statusMessageTs);
      console.log('🔄 Channel:', channelId, 'Response length:', aiResponse.response.length);
      slackResponse = await updateSlackMessage(channelId, statusMessageTs, aiResponse.response);
      console.log('🔄 Update response:', JSON.stringify(slackResponse));
      
      if (slackResponse && slackResponse.ok) {
        console.log('✅ Successfully updated existing message');
        responseTs = statusMessageTs; // Use the original message timestamp
      } else {
        console.log('⚠️ Failed to update message, error:', slackResponse);
        console.log('⚠️ Sending new message instead');
        // Fallback: send new message if update fails
        const newMessage = await sendSlackMessage(channelId, aiResponse.response, threadTs);
        console.log('📤 New message response:', JSON.stringify(newMessage));
        if (newMessage && newMessage.ok) {
          responseTs = newMessage.ts;
          slackResponse = newMessage;
        }
      }
    } else {
      console.log('⚠️ No status message timestamp, sending new message');
      // Fallback: send new message if status message failed initially
      slackResponse = await sendSlackMessage(channelId, aiResponse.response, threadTs);
      if (slackResponse && slackResponse.ok) {
        responseTs = slackResponse.ts;
      }
    }
    
    if (slackResponse && slackResponse.ok && responseTs) {
      console.log('✅ Message successfully processed in Slack with ts:', responseTs);

      // Add bot response to database
      const responseResult = await CentralizedDB.saveBotResponse(
        queryResult.query.id,
        conversation.id,
        aiResponse.response,
        {
          platformMessageId: responseTs,
          tokensUsed: aiResponse.tokensUsed,
          modelUsed: 'gemini-2.5-flash',
          processingTimeMs: aiResponse.processingTime,
          platformMetadata: { channelId, threadTs, parentMessageTs: messageTs }
        }
      );

      if (!responseResult.success) {
        console.error('❌ Failed to add bot response to database:', responseResult.error);
      } else {
        console.log('💾 Bot response added to database');
      }

      // Update conversation title if it doesn't have one
      if (!conversation.title) {
        try {
          const title = await generateConversationTitle(messageText);
          if (title && title.trim()) {
            await CentralizedDB.updateConversation(conversation.id, { title: title.trim() });
            console.log('📝 Conversation title updated:', title.trim());
          }
        } catch (error) {
          console.error('❌ Error generating conversation title:', error);
        }
      }

    } else {
      console.error('❌ Failed to send message to Slack:', slackResponse);
    }

  } catch (error) {
    console.error('❌ Error processing message:', error);
  }
}

// Helper function to determine if a reaction is positive or negative
function getReactionSentiment(reaction: string): 'positive' | 'negative' | 'neutral' {
  const positiveReactions = ['+1', 'thumbsup', 'heart', 'heart_eyes', 'fire', 'star', 'clap', 'raised_hands', '100', 'white_check_mark', 'ok_hand', 'muscle', 'sparkles', 'tada'];
  const negativeReactions = ['-1', 'thumbsdown', 'x', 'angry', 'rage', 'disappointed', 'confused', 'thinking_face', 'face_with_raised_eyebrow'];
  
  if (positiveReactions.includes(reaction)) {
    return 'positive';
  } else if (negativeReactions.includes(reaction)) {
    return 'negative';
  } else {
    return 'neutral';
  }
}

// Helper function to generate response based on reaction sentiment
function generateReactionResponse(sentiment: 'positive' | 'negative' | 'neutral'): string {
  switch (sentiment) {
    case 'positive':
      return "Thank you for your positive feedback! I'm glad my response was helpful. 😊";
    case 'negative':
      return "I'm sorry for not meeting your expectations. I'll try to improve my responses. Let me know if there's anything specific you'd like me to help with differently.";
    case 'neutral':
      return "Thank you for your feedback. I'm here to help if you have any questions or need clarification on anything.";
    default:
      return "Thank you for your feedback!";
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }

  try {
    const body = await req.text();
    
    if (!body) {
      console.log('⚠️ Empty request body');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const event = JSON.parse(body);
    console.log('🔍 Received Slack event:', event);

    // Handle URL verification challenge
    if (event.type === 'url_verification') {
      console.log('✅ URL verification challenge received');
      return new Response(JSON.stringify({ challenge: event.challenge }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Handle message events
    if (event.type === 'event_callback' && event.event?.type === 'message') {
      const messageEvent = event.event;
      const userId = messageEvent.user;
      const channelId = messageEvent.channel;
      const messageText = messageEvent.text;
      const messageTs = messageEvent.ts;
      const threadTs = messageEvent.thread_ts;
      const attachments = messageEvent.attachments;
      const files = messageEvent.files;

      console.log(`📨 Message from user ${userId} in channel ${channelId}: "${messageText}"`);

      // Ignore bot messages to prevent loops
      if (messageEvent.bot_id || messageEvent.subtype === 'bot_message') {
        console.log('🤖 Ignoring bot message to prevent loop');
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Check if message contains files or attachments
      if ((files && files.length > 0) || (attachments && attachments.length > 0)) {
        console.log('📎 Message contains files/attachments - rejecting');
        
        // Send rejection message
        setTimeout(async () => {
          await sendSlackMessage(
            channelId,
            "Sorry, I can only process text messages. I'm not able to recognize or process images, videos, or other file types."
          );
        }, 50);
        
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Ignore empty messages or messages without text
      if (!messageText || messageText.trim() === '') {
        console.log('⚠️ Ignoring empty message');
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Process the message in the background
      setTimeout(async () => {
        await processSlackMessage(userId, channelId, messageText, messageTs, threadTs);
      }, 100); // Small delay to avoid race conditions

      // Return immediate success to Slack
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Handle app mention events (when bot is mentioned in channels)
    if (event.type === 'event_callback' && event.event?.type === 'app_mention') {
      const mentionEvent = event.event;
      const userId = mentionEvent.user;
      const channelId = mentionEvent.channel;
      let messageText = mentionEvent.text;
      const messageTs = mentionEvent.ts;
      const threadTs = mentionEvent.thread_ts;
      const attachments = mentionEvent.attachments;
      const files = mentionEvent.files;

      console.log(`🔔 App mention from user ${userId} in channel ${channelId}: "${messageText}"`);

      // Check if message contains files or attachments
      if ((files && files.length > 0) || (attachments && attachments.length > 0)) {
        console.log('📎 App mention contains files/attachments - rejecting');
        
        // Send rejection message
        setTimeout(async () => {
          await sendSlackMessage(
            channelId,
            "Sorry, I can only process text messages. I'm not able to recognize or process images, videos, or other file types."
          );
        }, 50);
        
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Remove bot mention from the message text to get the actual query
      // Slack format: <@BOT_ID> hello -> hello
      const botMentionRegex = /^<@[A-Z0-9]+>\s*/i;
      if (botMentionRegex.test(messageText)) {
        messageText = messageText.replace(botMentionRegex, '').trim();
        console.log(`📝 Extracted query from mention: "${messageText}"`);
      }

      // Ignore empty messages or messages without text
      if (!messageText || messageText.trim() === '') {
        console.log('⚠️ Ignoring empty message');
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Process the mention in the background
      setTimeout(async () => {
        await processSlackMessage(userId, channelId, messageText, messageTs, threadTs);
      }, 100); // Small delay to avoid race conditions

      // Return immediate success to Slack
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Handle emoji reactions
    if (event.type === 'event_callback' && (event.event?.type === 'reaction_added' || event.event?.type === 'reaction_removed')) {
      const reactionEvent = event.event;
      console.log(`👍 Reaction ${event.event?.type === 'reaction_added' ? 'added' : 'removed'}:`, reactionEvent.reaction);
      
      // Process reaction in background
      setTimeout(async () => {
        try {
          const userResult = await CentralizedDB.upsertUser('slack', reactionEvent.user);
          if (userResult.success && userResult.user) {
            // Find the bot response by platform message ID
            const responseResult = await CentralizedDB.findBotResponseByPlatformMessageId(reactionEvent.item.ts);
            
            if (responseResult.success && responseResult.response) {
              if (event.event?.type === 'reaction_added') {
                await CentralizedDB.addMessageReaction(
                  responseResult.response.id,
                  userResult.user.id,
                  reactionEvent.reaction,
                  'slack'
                );
                console.log('✅ Reaction added to database');
                
                // Generate and send response based on reaction sentiment
                const sentiment = getReactionSentiment(reactionEvent.reaction);
                const responseText = generateReactionResponse(sentiment);
                
                // Send the response as a regular message (not in thread)
                await sendSlackMessage(
                  reactionEvent.item.channel, 
                  responseText
                  // No thread_ts parameter to send as regular message
                );
              } else {
                await CentralizedDB.removeMessageReaction(
                  responseResult.response.id,
                  userResult.user.id,
                  reactionEvent.reaction
                );
                console.log('✅ Reaction removed from database');
              }
            }
          }
        } catch (error) {
          console.error('❌ Error processing reaction:', error);
        }
      }, 50);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Error handling Slack event:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});