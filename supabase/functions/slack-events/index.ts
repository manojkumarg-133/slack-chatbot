// Slack Events Edge Function for Supabase
import { getOrCreateUser, getOrCreateConversation, addMessageReaction, removeMessageReaction, findBotResponseByTimestamp, updateBotResponseTimestamp, supabase } from '../_shared/database.ts';
import { generateGeminiResponse, generateReactionResponse } from '../_shared/gemini.ts';
import { sendSlackMessage, getSlackUserInfo, sendTypingIndicator, updateSlackMessage } from '../_shared/slack.ts';
import { isUserMuted } from '../_shared/slashCommands.ts';

const processedEvents = new Set<string>();

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.text();
    if (!body) return new Response('OK', { status: 200 });
    
    const eventData = JSON.parse(body);
    
    if (eventData.type === 'url_verification') {
      return new Response(eventData.challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    
    if (eventData.type === 'event_callback') {
      const event = eventData.event;
      const eventId = `${event.user}-${event.ts}`;
      
      if (processedEvents.has(eventId)) {
        return new Response('OK', { status: 200 });
      }
      
      processedEvents.add(eventId);
      
      setTimeout(async () => {
        try {
          if (event.type === 'app_mention') {
            await handleAppMention(event);
          } else if (event.type === 'message' && event.channel_type === 'im') {
            await handleDirectMessage(event);
          } else if (event.type === 'reaction_added') {
            await handleReactionAdded(event);
          } else if (event.type === 'reaction_removed') {
            await handleReactionRemoved(event);
          }
        } catch (error) {
          console.error('Error:', error);
        }
      }, 50);
      
      return new Response('OK', { status: 200 });
    }
    
    return new Response('OK', { status: 200 });
  } catch (error) {
    return new Response('Error', { status: 500 });
  }
});

async function handleAppMention(event: any) {
  try {
    console.log('📢 Handling app mention:', { user: event.user, channel: event.channel, thread_ts: event.thread_ts });
    
    // Ignore bot messages to prevent infinite loops
    if (event.bot_id || event.subtype === 'bot_message') {
      console.log('⏭️ Skipping bot message to prevent infinite loop');
      return;
    }

    // 🚫 DENY FILE/MEDIA UPLOADS - Check multiple ways Slack can send files/media
    const hasFiles = event.files && event.files.length > 0;
    const hasAttachments = event.attachments && event.attachments.length > 0;
    const hasSubtype = event.subtype && ['file_share', 'bot_message'].includes(event.subtype);
    const hasUpload = event.text && event.text.includes('uploaded a file');
    
    console.log('🔍 File detection - files:', hasFiles, 'attachments:', hasAttachments, 'subtype:', event.subtype, 'hasUpload:', hasUpload);
    
    if (hasFiles || hasAttachments || hasSubtype || hasUpload) {
      console.log('⏭️ Denying mention - contains file/media uploads (we only accept text)');
      await sendSlackMessage(
        event.channel, 
        '❌ Sorry, I can\'t access files or media. I can only process text messages.',
        event.thread_ts
      );
      return;
    }

    const userInfo = await getSlackUserInfo(event.user);
    if (!userInfo) return;

    const user = await getOrCreateUser(event.user, { 
      display_name: userInfo.name || 'Unknown',
      username: userInfo.name,
      email: userInfo.profile?.email,
      avatar_url: userInfo.profile?.image_original || userInfo.profile?.image_512,
      slack_team_id: userInfo.team_id
    });
    if (!user || isUserMuted(event.user)) return;

    const conversation = await getOrCreateConversation(user.id, event.channel, event.thread_ts);
    if (!conversation) return;

    let messageText = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim() || 'Hello!';
    
    // Show typing indicator
    console.log('💭 Sending typing indicator...');
    const typingMessage = await sendTypingIndicator(event.channel, event.thread_ts);
    
    // Generate AI response
    const aiResponse = await generateGeminiResponse(messageText, conversation.id, event.user) as any;
    const responseText = (aiResponse && aiResponse.success) ? aiResponse.response : "Sorry, I couldn't generate a response.";
    
    // Update the typing message with the actual response
    if (typingMessage.ok && typingMessage.ts) {
      console.log('🔄 Updating typing message with response...');
      const updateResult = await updateSlackMessage(event.channel, typingMessage.ts, responseText);
      
      // Store the Slack message timestamp if we have queryId
      console.log('💾 AI Response details (handleAppMention):', { success: aiResponse?.success, queryId: aiResponse?.queryId, timestamp: typingMessage.ts });
      if (aiResponse && aiResponse.queryId && aiResponse.queryId !== 'unknown') {
        console.log('💾 Updating bot response with timestamp (handleAppMention):', aiResponse.queryId, typingMessage.ts);
        const updateSuccess = await updateBotResponseTimestamp(aiResponse.queryId, typingMessage.ts);
        console.log('💾 Timestamp update result (handleAppMention):', updateSuccess);
      } else {
        console.log('❌ No queryId available to update timestamp (handleAppMention)');
      }
      
      if (!updateResult) {
        // If update failed, send a new message
        const newMessage = await sendSlackMessage(event.channel, responseText, event.thread_ts);
        if (newMessage && newMessage.ts && aiResponse && aiResponse.queryId && aiResponse.queryId !== 'unknown') {
          console.log('💾 Updating bot response with new message timestamp:', aiResponse.queryId, newMessage.ts);
          await updateBotResponseTimestamp(aiResponse.queryId, newMessage.ts);
        }
      }
    } else {
      // If typing message failed, send the response directly
      const newMessage = await sendSlackMessage(event.channel, responseText, event.thread_ts);
      if (newMessage && newMessage.ts && aiResponse && aiResponse.queryId && aiResponse.queryId !== 'unknown') {
        console.log('💾 Updating bot response with direct message timestamp:', aiResponse.queryId, newMessage.ts);
        await updateBotResponseTimestamp(aiResponse.queryId, newMessage.ts);
      }
    }
  } catch (error) {
    console.error('Error in handleAppMention:', error);
  }
}

async function handleDirectMessage(event: any) {
  try {
    // Ignore bot messages to prevent infinite loops
    if (event.bot_id || event.subtype === 'bot_message') {
      console.log('⏭️ Skipping bot message to prevent infinite loop');
      return;
    }

    // 🚫 DENY FILE/MEDIA UPLOADS in DMs too
    const hasFiles = event.files && event.files.length > 0;
    const hasAttachments = event.attachments && event.attachments.length > 0;
    const hasSubtype = event.subtype && ['file_share'].includes(event.subtype);
    
    console.log('🔍 DM File detection - files:', hasFiles, 'attachments:', hasAttachments, 'subtype:', event.subtype);
    
    if (hasFiles || hasAttachments || hasSubtype) {
      console.log('⏭️ Denying DM - contains file/media uploads (we only accept text)');
      await sendSlackMessage(
        event.channel, 
        '❌ Sorry, I can\'t access files or media. I can only process text messages.'
      );
      return;
    }

    const userInfo = await getSlackUserInfo(event.user);
    if (!userInfo) return;

  const user = await getOrCreateUser(event.user, { platform_user_id: event.user, display_name: userInfo.name || 'Unknown' });
    if (!user || isUserMuted(event.user)) return;

    const conversation = await getOrCreateConversation(user.id, event.channel);
    if (!conversation) return;

    const messageText = event.text || 'Hello!';
    
    // Show typing indicator
    console.log('💭 Sending typing indicator...');
    const typingMessage = await sendTypingIndicator(event.channel);
    
    // Generate AI response
    const aiResponse = await generateGeminiResponse(messageText, conversation.id, event.user) as any;
    const responseText = (aiResponse && aiResponse.success) ? aiResponse.response : "Sorry, I couldn't generate a response.";
    
    // Update the typing message with the actual response
    if (typingMessage.ok && typingMessage.ts) {
      console.log('🔄 Updating typing message with response...');
      const updateResult = await updateSlackMessage(event.channel, typingMessage.ts, responseText);
      
      // Store the Slack message timestamp if we have queryId
      if (aiResponse && aiResponse.queryId && aiResponse.queryId !== 'unknown') {
        await updateBotResponseTimestamp(aiResponse.queryId, typingMessage.ts);
      }
      
      if (!updateResult) {
        // If update failed, send a new message
        const newMessage = await sendSlackMessage(event.channel, responseText);
        if (newMessage && newMessage.ts && aiResponse && aiResponse.queryId && aiResponse.queryId !== 'unknown') {
          await updateBotResponseTimestamp(aiResponse.queryId, newMessage.ts);
        }
      }
    } else {
      // If typing message failed, send the response directly
      const newMessage = await sendSlackMessage(event.channel, responseText);
      if (newMessage && newMessage.ts && aiResponse && aiResponse.queryId && aiResponse.queryId !== 'unknown') {
        await updateBotResponseTimestamp(aiResponse.queryId, newMessage.ts);
      }
    }
  } catch (error) {
    console.error('Error in handleDirectMessage:', error);
  }
}

async function handleReactionAdded(event: any) {
  try {
    console.log('👍 Handling reaction added:', JSON.stringify(event, null, 2));

    // Skip if it's a bot reaction or system user
    if (event.user === 'USLACKBOT' || !event.user) {
      console.log('⏭️ Skipping system/bot reaction');
      return;
    }

    console.log('🔍 Event details - User:', event.user, 'Reaction:', event.reaction, 'Item TS:', event.item.ts, 'Channel:', event.item.channel);

    const userInfo = await getSlackUserInfo(event.user);
    if (!userInfo) {
      console.log('❌ Could not get user info for reaction');
      return;
    }

    // Get or create user
    const user = await getOrCreateUser(event.user, { 
      platform_user_id: event.user, 
      display_name: userInfo.name || 'Unknown' 
    });
    if (!user) {
      console.log('❌ Could not get/create user for reaction');
      return;
    }

    console.log('👤 User found/created:', user.id);

    // Find the bot response by message timestamp
    console.log('🔍 Searching for bot response with timestamp:', event.item.ts);
  const botResponse = await findBotResponseByTimestamp(event.item.ts, event.item.channel);
    if (!botResponse) {
      console.log('❌ Could not find bot response for reaction with timestamp:', event.item.ts);
      
      // Let's also try to find all bot responses to debug
      const { data: allResponses } = await supabase.from('bot_responses').select('id, slack_message_ts, created_at').order('created_at', { ascending: false }).limit(10);
      console.log('🔍 Recent bot responses:', JSON.stringify(allResponses, null, 2));
      
      return;
    }

    // Add reaction to database
    const reactionAdded = await addMessageReaction(
      botResponse.id,
      event.user,
      event.reaction
    );

    if (reactionAdded) {
      console.log('✅ Reaction added to database');
      
      // Generate a response based on the reaction sentiment
      const reactionResponse = await generateReactionResponse(event.reaction);
      
      if (reactionResponse.success) {
        // Send the sentiment-based response directly in the channel (not as thread reply)
        await sendSlackMessage(
          event.item.channel,
          reactionResponse.response
          // Removed thread_ts parameter to send directly in channel
        );
        console.log('💬 Sent reaction response:', reactionResponse.response);
      }
    } else {
      console.log('❌ Failed to add reaction to database');
    }

  } catch (error) {
    console.error('Error in handleReactionAdded:', error);
  }
}

async function handleReactionRemoved(event: any) {
  try {
    console.log('👎 Handling reaction removed:', event);

    // Skip if it's a bot reaction or system user
    if (event.user === 'USLACKBOT' || !event.user) {
      console.log('⏭️ Skipping system/bot reaction removal');
      return;
    }

    const userInfo = await getSlackUserInfo(event.user);
    if (!userInfo) {
      console.log('❌ Could not get user info for reaction removal');
      return;
    }

    // Get or create user
    const user = await getOrCreateUser(event.user, { 
      platform_user_id: event.user, 
      display_name: userInfo.name || 'Unknown' 
    });
    if (!user) {
      console.log('❌ Could not get/create user for reaction removal');
      return;
    }

    // Find the bot response by message timestamp
  const botResponse = await findBotResponseByTimestamp(event.item.ts, event.item.channel);
    if (!botResponse) {
      console.log('❌ Could not find bot response for reaction removal');
      return;
    }

    // Remove reaction from database
    const reactionRemoved = await removeMessageReaction(
      botResponse.id,
      event.user,
      event.reaction
    );

    if (reactionRemoved) {
      console.log('✅ Reaction removed from database');
    } else {
      console.log('❌ Failed to remove reaction from database');
    }

  } catch (error) {
    console.error('Error in handleReactionRemoved:', error);
  }
}
