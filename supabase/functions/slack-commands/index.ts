// Slack Commands Edge Function for Supabase
import { CentralizedDB } from '../_shared/centralized-database.ts';
import { 
  createNewConversationForUser,
  getConversationStats
} from '../_shared/slashCommands.ts';
import { sendDelayedResponse, sendSlackMessage, updateSlackMessage, sendTypingIndicator, clearScreenMessages, parseSlackRequestBody } from '../_shared/slack.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    console.log('🔍 Incoming slash command request');
    
    const body = await req.text();
    
    if (!body) {
      console.log('⚠️ Empty request body');
      return new Response('OK', { status: 200 });
    }
    
    // Parse the form data
    const params = parseSlackRequestBody(body);
    const command = params.command;
    const text = params.text || '';
    const userId = params.user_id;
    const channelId = params.channel_id;
    const responseUrl = params.response_url;
    
    console.log('📨 Received slash command:', command);
    console.log('👤 User ID:', userId);

    // Verify the request is from Slack
    if (!userId || !channelId || !command || !responseUrl) {
      console.log('❌ Invalid request - missing required fields');
      return new Response(JSON.stringify({ 
        response_type: "ephemeral",
        text: "❌ Invalid request. Please try again." 
      }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Handle different commands and respond immediately to avoid timeout
    switch (command) {
      case '/clear':
        // Clear messages from screen only, keep database intact
        setTimeout(async () => {
          try {
            const userResult = await CentralizedDB.upsertUser('slack', userId);
            if (!userResult.success || !userResult.user) {
              await sendDelayedResponse(responseUrl, 'Error finding your user account.', true);
              return;
            }
            
            const conversationResult = await CentralizedDB.getOrCreateConversation('slack', userResult.user.id, channelId);
            if (!conversationResult.success || !conversationResult.conversation) {
              await sendDelayedResponse(responseUrl, 'No conversation found.', true);
              return;
            }

            // Delete bot messages from the screen (Slack limitation: cannot delete user messages)
            const slackToken = Deno.env.get('SLACK_BOT_TOKEN') || '';
            const cleared = await clearScreenMessages(channelId, slackToken);
            
            if (cleared) {
              await sendDelayedResponse(responseUrl, `🧹 **Bot Messages Cleared!**

I've removed my previous messages from this conversation. Due to Slack API limitations, I cannot delete your messages - only my own responses.

💾 *Note: Your conversation context is preserved and will continue normally.*`);
            } else {
              await sendDelayedResponse(responseUrl, `⚠️ **Limited Clearing**

Due to Slack API restrictions, I can only delete my own messages, not yours. Your conversation context remains intact.

💬 *To truly start fresh, use /new-chat instead.*`, true);
            }
            console.log(`✅ User ${userId} cleared bot messages for conversation ${conversationResult.conversation.id}`);
          } catch (error) {
            console.error('❌ Error in /clear command:', error);
            await sendDelayedResponse(responseUrl, 'An error occurred while clearing the screen.', true);
          }
        }, 50);

        return new Response(JSON.stringify({
          response_type: "ephemeral",
          text: "🔄 Clearing messages from screen..."
        }), { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

      case '/new-chat':
        // Clear screen and create new conversation ID
        setTimeout(async () => {
          try {
            const userResult = await CentralizedDB.upsertUser('slack', userId);
            if (!userResult.success || !userResult.user) {
              await sendDelayedResponse(responseUrl, 'Error finding your user account.', true);
              return;
            }
            
            const newConversationId = await createNewConversationForUser(userResult.user.id, channelId);
            if (newConversationId) {
              await sendDelayedResponse(responseUrl, `🆕 **New Chat Started!**

✨ Fresh conversation created with ID: \`${newConversationId}\`

🧹 Screen cleared and ready for a brand new conversation!

💾 *Your previous conversation data is preserved separately.*`);
              console.log(`✅ User ${userId} started new conversation ${newConversationId}`);
            } else {
              await sendDelayedResponse(responseUrl, 'Failed to start new chat. Please try again.', true);
            }
          } catch (error) {
            console.error('❌ Error in /new-chat command:', error);
            await sendDelayedResponse(responseUrl, 'An error occurred while starting new chat.', true);
          }
        }, 50);

        return new Response(JSON.stringify({
          response_type: "ephemeral",
          text: "🔄 Creating a new chat conversation..."
        }), { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });      case '/delete':
        // Delete everything: screen messages AND database records
        setTimeout(async () => {
          try {
            const userResult = await CentralizedDB.upsertUser('slack', userId);
            if (!userResult.success || !userResult.user) {
              await sendDelayedResponse(responseUrl, 'Error finding your user account.', true);
              return;
            }

            const conversationResult = await CentralizedDB.getOrCreateConversation('slack', userResult.user.id, channelId);
            if (!conversationResult.success || !conversationResult.conversation) {
              await sendDelayedResponse(responseUrl, 'No conversation found to delete.', true);
              return;
            }

            const stats = await getConversationStats(conversationResult.conversation.id);
            if (!stats || stats.messageCount === 0) {
              await sendDelayedResponse(responseUrl, 'ℹ️ No messages to delete. Your chat is already empty!');
              return;
            }

            // Archive conversation instead of deleting
            const dbSuccess = await CentralizedDB.archiveConversation(conversationResult.conversation.id);
            
            // Try to clear bot messages from screen
            const slackToken = Deno.env.get('SLACK_BOT_TOKEN') || '';
            const screenCleared = await clearScreenMessages(channelId, slackToken);
            
            if (dbSuccess) {
              let message = `🗑️ **Conversation Deleted!**

✅ Successfully deleted ${stats.messageCount} messages from database.`;
              
              if (screenCleared) {
                message += `\n✅ Also cleared my messages from the screen.`;
              } else {
                message += `\n⚠️ Database cleared, but couldn't remove screen messages (Slack API limitation).`;
              }
              
              message += `\n\nThis conversation has been completely removed. Your next message will start a fresh conversation.`;
              
              await sendDelayedResponse(responseUrl, message);
              console.log(`✅ User ${userId} deleted conversation ${conversationResult.conversation.id} completely`);
            } else {
              await sendDelayedResponse(responseUrl, 'Failed to delete conversation. Please try again.', true);
            }
          } catch (error) {
            console.error('❌ Error in /delete command:', error);
            await sendDelayedResponse(responseUrl, 'An error occurred while deleting the conversation.', true);
          }
        }, 50);

        return new Response(JSON.stringify({
          response_type: "ephemeral",
          text: "🔄 Deleting conversation from screen and database..."
        }), { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });



      case '/help':
        return new Response(JSON.stringify({
          response_type: "ephemeral",
          text: `🤖 **Zen-AI Bot Commands**

**Available Commands:**
• \`/clear\` - Remove bot messages from screen (conversation context preserved)
• \`/delete\` - Delete entire conversation + all database records  
• \`/new-chat\` - Start completely new conversation with fresh ID

⚠️ **Important:** Due to Slack API limitations, \`/clear\` can only remove my messages, not yours. For a completely fresh start, use \`/new-chat\`.

**Features:**
✅ Multi-language support (responds in your language)
✅ Conversation history and context
✅ Emoji reaction sentiment analysis  
✅ Works in channels and DMs

Need help? Just @mention me with your question! 💬`
        }), { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });

      default:
        // Unknown command
        console.log('❌ Unknown command:', command);
        return new Response(JSON.stringify({
          response_type: "ephemeral",
          text: `❌ Unknown command: ${command}

Available commands:
• \`/clear\` - Clear messages from screen only
• \`/delete\` - Delete everything (screen + database)
• \`/new-chat\` - Start fresh conversation
• \`/help\` - Show help message`
        }), { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
    }

  } catch (error) {
    console.error('❌ Error handling slash command:', error);
    return new Response(JSON.stringify({
      response_type: "ephemeral", 
      text: "❌ An unexpected error occurred. Please try again."
    }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});