// Slack Events Edge Function for Centralized Multi-Platform Schema
import { 
  getOrCreateUser, 
  getOrCreateConversation, 
  saveUserQuery,
  saveBotResponse,
  addMessageReaction, 
  removeMessageReaction, 
  findBotResponseByTimestamp, 
  updateBotResponseTimestamp, 
  updateConversationActivity,
  supabase 
} from '../_shared/database-centralized.ts';
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
          console.error('Error processing event:', error);
        }
      }, 50);
      
      return new Response('OK', { status: 200 });
    }
    
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Error in Slack events handler:', error);
    return new Response('Error processing request', { status: 500 });
  }
});

async function handleAppMention(event: any) {
  console.log('🤖 Handling app mention:', event);
  
  if (event.user === process.env.SLACK_BOT_USER_ID) {
    console.log('🤖 Ignoring self-message');
    return;
  }

  const startTime = Date.now();
  
  try {
    // Check if user is muted
    if (await isUserMuted(event.user)) {
      console.log('🔇 User is muted, ignoring message');
      return;
    }

    // Get or create user
    const userInfo = await getSlackUserInfo(event.user);
    const user = await getOrCreateUser(event.user, { 
      display_name: userInfo?.name || 'Unknown'
    });

    if (!user) {
      console.error('❌ Failed to get/create user');
      return;
    }

    // Get or create conversation
    const conversation = await getOrCreateConversation(
      user.id,
      event.channel,
      event.thread_ts
    );

    if (!conversation) {
      console.error('❌ Failed to get/create conversation');
      return;
    }

    // Clean the message text (remove bot mention)
    const cleanText = event.text.replace(/<@[^>]+>/g, '').trim();
    
    // Save user query
    const userQuery = await saveUserQuery(
      conversation.id,
      user.id,
      cleanText,
      event.ts
    );

    if (!userQuery) {
      console.error('❌ Failed to save user query');
      return;
    }

    // Send typing indicator
    await sendTypingIndicator(event.channel);
    
    // Generate AI response
    const aiResponse = await generateGeminiResponse(cleanText, conversation.id);
    
    // Send response to Slack
    const slackResponse = await sendSlackMessage(
      event.channel,
      aiResponse.content,
      event.thread_ts
    );

    if (slackResponse?.ok && slackResponse.message?.ts) {
      // Save bot response with Slack timestamp
      await saveBotResponse(
        userQuery.id,
        conversation.id,
        aiResponse.content,
        aiResponse.model_used,
        aiResponse.tokens_used,
        Date.now() - startTime,
        slackResponse.message.ts
      );
    } else {
      // Save bot response without Slack timestamp
      await saveBotResponse(
        userQuery.id,
        conversation.id,
        aiResponse.content,
        aiResponse.model_used,
        aiResponse.tokens_used,
        Date.now() - startTime,
        undefined,
        'Failed to send to Slack'
      );
    }

    // Update conversation activity
    await updateConversationActivity(conversation.id);

    console.log(`✅ App mention processed in ${Date.now() - startTime}ms`);

  } catch (error) {
    console.error('❌ Error handling app mention:', error);
    
    // Try to send error message to user
    try {
      await sendSlackMessage(
        event.channel,
        "Sorry, I encountered an error processing your message. Please try again.",
        event.thread_ts
      );
    } catch (slackError) {
      console.error('❌ Failed to send error message to Slack:', slackError);
    }
  }
}

async function handleDirectMessage(event: any) {
  console.log('💬 Handling direct message:', event);
  
  if (event.user === process.env.SLACK_BOT_USER_ID) {
    console.log('🤖 Ignoring self-message');
    return;
  }

  const startTime = Date.now();

  try {
    // Check if user is muted
    if (await isUserMuted(event.user)) {
      console.log('🔇 User is muted, ignoring message');
      return;
    }

    // Get or create user
    const userInfo = await getSlackUserInfo(event.user);
    const user = await getOrCreateUser(event.user, { 
      display_name: userInfo?.name || 'Unknown'
    });

    if (!user) {
      console.error('❌ Failed to get/create user');
      return;
    }

    // Get or create conversation
    const conversation = await getOrCreateConversation(
      user.id,
      event.channel
    );

    if (!conversation) {
      console.error('❌ Failed to get/create conversation');
      return;
    }

    // Save user query
    const userQuery = await saveUserQuery(
      conversation.id,
      user.id,
      event.text,
      event.ts
    );

    if (!userQuery) {
      console.error('❌ Failed to save user query');
      return;
    }

    // Send typing indicator
    await sendTypingIndicator(event.channel);
    
    // Generate AI response
    const aiResponse = await generateGeminiResponse(event.text, conversation.id);
    
    // Send response to Slack
    const slackResponse = await sendSlackMessage(event.channel, aiResponse.content);

    if (slackResponse?.ok && slackResponse.message?.ts) {
      // Save bot response with Slack timestamp
      await saveBotResponse(
        userQuery.id,
        conversation.id,
        aiResponse.content,
        aiResponse.model_used,
        aiResponse.tokens_used,
        Date.now() - startTime,
        slackResponse.message.ts
      );
    } else {
      // Save bot response without Slack timestamp
      await saveBotResponse(
        userQuery.id,
        conversation.id,
        aiResponse.content,
        aiResponse.model_used,
        aiResponse.tokens_used,
        Date.now() - startTime,
        undefined,
        'Failed to send to Slack'
      );
    }

    // Update conversation activity
    await updateConversationActivity(conversation.id);

    console.log(`✅ Direct message processed in ${Date.now() - startTime}ms`);

  } catch (error) {
    console.error('❌ Error handling direct message:', error);
    
    // Try to send error message to user
    try {
      await sendSlackMessage(
        event.channel,
        "Sorry, I encountered an error processing your message. Please try again."
      );
    } catch (slackError) {
      console.error('❌ Failed to send error message to Slack:', slackError);
    }
  }
}

async function handleReactionAdded(event: any) {
  console.log('👍 Handling reaction added:', event);

  try {
    if (event.user === process.env.SLACK_BOT_USER_ID) {
      console.log('🤖 Ignoring self-reaction');
      return;
    }

    // Find the bot response by Slack timestamp
    const botResponse = await findBotResponseByTimestamp(event.item.ts);
    
    if (!botResponse) {
      console.log('❌ Bot response not found for reaction');
      return;
    }

    // Add reaction to database
    const success = await addMessageReaction(
      botResponse.id,
      event.user,
      event.reaction
    );

    if (success) {
      console.log(`✅ Added reaction ${event.reaction} to response ${botResponse.id}`);
      
      // Generate reaction response if configured
      try {
        const reactionResponse = await generateReactionResponse(
          event.reaction,
          botResponse.content,
          botResponse.conversation_id
        );
        
        if (reactionResponse) {
          await sendSlackMessage(
            event.item.channel,
            reactionResponse,
            event.item.ts
          );
        }
      } catch (reactionError) {
        console.error('❌ Error generating reaction response:', reactionError);
      }
    }

  } catch (error) {
    console.error('❌ Error handling reaction added:', error);
  }
}

async function handleReactionRemoved(event: any) {
  console.log('👎 Handling reaction removed:', event);

  try {
    if (event.user === process.env.SLACK_BOT_USER_ID) {
      console.log('🤖 Ignoring self-reaction');
      return;
    }

    // Find the bot response by Slack timestamp
    const botResponse = await findBotResponseByTimestamp(event.item.ts);
    
    if (!botResponse) {
      console.log('❌ Bot response not found for reaction removal');
      return;
    }

    // Remove reaction from database
    const success = await removeMessageReaction(
      botResponse.id,
      event.user,
      event.reaction
    );

    if (success) {
      console.log(`✅ Removed reaction ${event.reaction} from response ${botResponse.id}`);
    }

  } catch (error) {
    console.error('❌ Error handling reaction removed:', error);
  }
}