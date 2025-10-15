import { NextRequest, NextResponse } from 'next/server';import { NextRequest, NextResponse } from 'next/server';

import { import { 

  getOrCreateUser,   getOrCreateUser, 

  getOrCreateConversation,  getOrCreateConversation,

} from '@/lib/database';} from '@/lib/database';

import { import { 

  clearConversation,  clearConversation,

  createNewConversationForUser,  createNewConversationForUser,

  deleteConversationData,  deleteConversationData,

  getConversationStats,  getConversationStats,

} from '@/lib/slashCommands';  muteUser,

  unmuteUser,

// Helper function to send delayed responses using response_url  isUserMuted

async function sendDelayedResponse(responseUrl: string, message: string, isError = false) {} from '@/lib/slashCommands';

  try {

    await fetch(responseUrl, {// Helper function to send delayed responses using response_url

      method: 'POST',async function sendDelayedResponse(responseUrl: string, message: string, isError = false) {

      headers: {  try {

        'Content-Type': 'application/json',    await fetch(responseUrl, {

      },      method: 'POST',

      body: JSON.stringify({      headers: {

        response_type: 'ephemeral',        'Content-Type': 'application/json',

        text: isError ? `❌ ${message}` : message      },

      }),      body: JSON.stringify({

    });        response_type: 'ephemeral',

  } catch (error) {        text: isError ? `❌ ${message}` : message

    console.error('Error sending delayed response:', error);      }),

  }    });

}  } catch (error) {

    console.error('Error sending delayed response:', error);

export async function POST(request: NextRequest) {  }

  try {}

    console.log('🔍 Incoming slash command request');

    export async function POST(request: NextRequest) {

    const body = await request.text();  try {

        console.log('🔍 Incoming slash command request');

    if (!body) {    

      console.log('⚠️ Empty request body');    const body = await request.text();

      return NextResponse.json({ ok: true }, { status: 200 });    

    }    if (!body) {

          console.log('⚠️ Empty request body');

    // Parse the form data      return NextResponse.json({ ok: true }, { status: 200 });

    const params = new URLSearchParams(body);    }

    const command = params.get('command');    

    const text = params.get('text') || '';    // Parse the form data

    const userId = params.get('user_id');    const params = new URLSearchParams(body);

    const channelId = params.get('channel_id');    const command = params.get('command');

    const responseUrl = params.get('response_url');    const text = params.get('text') || '';

        const userId = params.get('user_id');

    console.log('📨 Received slash command:', command);    const channelId = params.get('channel_id');

    console.log('👤 User ID:', userId);    const responseUrl = params.get('response_url');

    

    // Verify the request is from Slack    console.log('📨 Received slash command:', command);

    if (!userId || !channelId || !command || !responseUrl) {    console.log('👤 User ID:', userId);

      console.log('❌ Invalid request - missing required fields');

      return NextResponse.json(    // Verify the request is from Slack

        {     if (!userId || !channelId || !command || !responseUrl) {

          response_type: "ephemeral",      console.log('❌ Invalid request - missing required fields');

          text: "❌ Invalid request. Please try again."       return NextResponse.json(

        },         { 

        { status: 200 }          response_type: "ephemeral",

      );          text: "❌ Invalid request. Please try again." 

    }        }, 

        { status: 200 }

    // Handle different commands and respond immediately to avoid timeout      );

    switch (command) {    }

      case '/clear':

        setTimeout(async () => {    // Handle different commands and respond immediately to avoid timeout

          try {    switch (command) {

            const user = await getOrCreateUser(userId);      case '/clear':

            if (!user) {        // Acknowledge immediately (within 3 seconds)

              await sendDelayedResponse(responseUrl, 'Error finding your user account.', true);        setTimeout(async () => {

              return;          try {

            }            const user = await getOrCreateUser(userId);

                        if (!user) {

            const conversation = await getOrCreateConversation(user.id, channelId);              await sendDelayedResponse(responseUrl, 'Error finding your user account.', true);

            if (!conversation) {              return;

              await sendDelayedResponse(responseUrl, 'No conversation found.', true);            }

              return;            

            }            const conversation = await getOrCreateConversation(user.id, channelId);

                        if (!conversation) {

            const stats = await getConversationStats(conversation.id);              await sendDelayedResponse(responseUrl, 'No conversation found.', true);

            if (!stats || stats.messageCount === 0) {              return;

              await sendDelayedResponse(responseUrl, 'ℹ️ No messages to clear. Your chat is already empty!');            }

              return;            

            }            const stats = await getConversationStats(conversation.id);

            if (!stats || stats.messageCount === 0) {

            const result = await clearConversation(conversation.id);              await sendDelayedResponse(responseUrl, 'ℹ️ No messages to clear. Your chat is already empty!');

            if (result) {              return;

              await sendDelayedResponse(responseUrl, `✅ **Screen Cleared!**            }



📊 Cleared ${stats.messageCount} messages from screen view.            const result = await clearConversation(conversation.id);

            if (result) {

💾 Database kept intact - conversation continues with same ID.`);              await sendDelayedResponse(responseUrl, `✅ **Chat Cleared!**

              console.log(`✅ User ${userId} cleared screen for conversation ${conversation.id}`);

            } else {📊 Cleared ${stats.messageCount} messages from this conversation.

              await sendDelayedResponse(responseUrl, 'Failed to clear chat. Please try again.', true);

            }Your conversation history has been reset. Future messages will start a fresh conversation with context.`);

          } catch (error) {              console.log(`✅ User ${userId} cleared conversation ${conversation.id}`);

            console.error('❌ Error in /clear command:', error);            } else {

            await sendDelayedResponse(responseUrl, 'An error occurred while clearing the chat.', true);              await sendDelayedResponse(responseUrl, 'Failed to clear chat. Please try again.', true);

          }            }

        }, 50);          } catch (error) {

            console.error('❌ Error in /clear command:', error);

        return NextResponse.json({            await sendDelayedResponse(responseUrl, 'An error occurred while clearing the chat.', true);

          response_type: "ephemeral",          }

          text: "🔄 Clearing messages from screen..."        }, 50); // Reduced delay to respond faster

        }, { status: 200 });

        return NextResponse.json({

      case '/delete':          response_type: "ephemeral",

        setTimeout(async () => {          text: "🔄 Clearing your conversation history..."

          try {        }, { status: 200 });

            const user = await getOrCreateUser(userId);

            if (!user) {      case '/new-chat':

              await sendDelayedResponse(responseUrl, 'Error finding your user account.', true);        setTimeout(async () => {

              return;          try {

            }            const user = await getOrCreateUser(userId);

            if (!user) {

            const conversation = await getOrCreateConversation(user.id, channelId);              await sendDelayedResponse(responseUrl, 'Error finding your user account.', true);

            if (!conversation) {              return;

              await sendDelayedResponse(responseUrl, 'No conversation found to delete.', true);            }

              return;

            }            const newConversationId = await createNewConversationForUser(user.id, channelId);

            if (newConversationId) {

            const stats = await getConversationStats(conversation.id);              await sendDelayedResponse(responseUrl, `✅ **New Chat Started!**

            const success = await deleteConversationData(conversation.id);

            🆕 Conversation ID: \`${newConversationId}\`

            if (success) {

              await sendDelayedResponse(responseUrl, `✅ **Conversation Deleted**Your conversation history has been reset. This is now a fresh conversation with the AI assistant.`);

              console.log(`✅ User ${userId} started new conversation ${newConversationId}`);

🗑️ Deleted from screen and database:            } else {

• ${stats?.messageCount || 0} messages              await sendDelayedResponse(responseUrl, 'Failed to start new chat. Please try again.', true);

• ${stats?.responseCount || 0} responses              }

• ${stats?.reactionCount || 0} reactions          } catch (error) {

            console.error('❌ Error in /new-chat command:', error);

Your conversation has been completely removed.`);            await sendDelayedResponse(responseUrl, 'An error occurred while starting new chat.', true);

              console.log(`✅ User ${userId} deleted conversation data`);          }

            } else {        }, 50);

              await sendDelayedResponse(responseUrl, 'Failed to delete conversation. Please try again.', true);

            }        return NextResponse.json({

          } catch (error) {          response_type: "ephemeral",

            console.error('❌ Error in /delete command:', error);          text: "🔄 Starting a new chat conversation..."

            await sendDelayedResponse(responseUrl, 'An error occurred while deleting the conversation.', true);        }, { status: 200 });

          }

        }, 50);      case '/delete':

        setTimeout(async () => {

        return NextResponse.json({          try {

          response_type: "ephemeral",            const user = await getOrCreateUser(userId);

          text: "🗑️ Deleting conversation from screen and database..."            if (!user) {

        }, { status: 200 });              await sendDelayedResponse(responseUrl, 'Error finding your user account.', true);

              return;

      case '/new-chat':            }

        setTimeout(async () => {

          try {            const conversation = await getOrCreateConversation(user.id, channelId);

            const user = await getOrCreateUser(userId);            if (!conversation) {

            if (!user) {              await sendDelayedResponse(responseUrl, 'No conversation found to delete.', true);

              await sendDelayedResponse(responseUrl, 'Error finding your user account.', true);              return;

              return;            }

            }

            const stats = await getConversationStats(conversation.id);

            const newConversationId = await createNewConversationForUser(user.id, channelId);            const success = await deleteConversationData(conversation.id);

            if (newConversationId) {            

              await sendDelayedResponse(responseUrl, `✅ **New Chat Started!**            if (success) {

              await sendDelayedResponse(responseUrl, `✅ **Conversation Deleted**

🆕 Conversation ID: \`${newConversationId}\`

🗑️ Deleted from screen and database:

Screen cleared and fresh conversation started. Your previous conversations remain in the database.`);• ${stats?.messageCount || 0} messages

              console.log(`✅ User ${userId} started new conversation ${newConversationId}`);• ${stats?.responseCount || 0} responses  

            } else {• ${stats?.reactionCount || 0} reactions

              await sendDelayedResponse(responseUrl, 'Failed to start new chat. Please try again.', true);

            }Your conversation has been completely removed.`);

          } catch (error) {              console.log(`✅ User ${userId} deleted conversation data`);

            console.error('❌ Error in /new-chat command:', error);            } else {

            await sendDelayedResponse(responseUrl, 'An error occurred while starting new chat.', true);              await sendDelayedResponse(responseUrl, 'Failed to delete conversation. Please try again.', true);

          }            }

        }, 50);          } catch (error) {

            console.error('❌ Error in /delete command:', error);

        return NextResponse.json({            await sendDelayedResponse(responseUrl, 'An error occurred while deleting the conversation.', true);

          response_type: "ephemeral",          }

          text: "🔄 Starting a new chat conversation..."        }, 50);

        }, { status: 200 });

        return NextResponse.json({

      case '/help':          response_type: "ephemeral",

        return NextResponse.json({          text: "�️ Deleting conversation from screen and database..."

          response_type: "ephemeral",        }, { status: 200 });

          text: `🤖 **Zen-AI Bot Commands**

      case '/help':

**Available Commands:**        return NextResponse.json({

• \`/clear\` - Clear messages from screen (keeps database)          response_type: "ephemeral",

• \`/delete\` - Delete conversation from screen AND database            text: `🤖 **Zen-AI Bot Commands**

• \`/new-chat\` - Start a fresh conversation with new ID

• \`/help\` - Show this help message**Available Commands:**

• \`/clear\` - Clear messages from screen (keeps database)

**Features:**• \`/delete\` - Delete conversation from screen AND database  

✅ Multi-language support (responds in your language)• \`/new-chat\` - Start a fresh conversation with new ID

✅ Conversation history and context• \`/help\` - Show this help message

✅ Emoji reaction sentiment analysis

✅ Works in channels and DMs**Features:**

✅ Multi-language support (responds in your language)

Need help? Just @mention me with your question! 💬`✅ Conversation history and context

        }, { status: 200 });✅ Emoji reaction sentiment analysis

✅ Works in channels and DMs

      default:

        return NextResponse.json({Need help? Just @mention me with your question! 💬`

          response_type: "ephemeral",        }, { status: 200 });

          text: `❓ **Unknown Command: \`${command}\`**

      default:

Available commands:        return NextResponse.json({

• \`/clear\` - Clear messages from screen only          response_type: "ephemeral",

• \`/delete\` - Delete conversation completely          text: `❓ **Unknown Command: \`${command}\`**

• \`/new-chat\` - Start a new conversation

• \`/help\` - Show help message`Available commands:

        }, { status: 200 });• \`/clear\` - Clear messages from screen only

    }• \`/delete\` - Delete conversation completely

• \`/new-chat\` - Start a new conversation

  } catch (error) {• \`/help\` - Show help message`

    console.error('❌ Error handling slash command:', error);        }, { status: 200 });

    return NextResponse.json({    }

      response_type: "ephemeral", 

      text: "❌ An unexpected error occurred. Please try again."  } catch (error) {

    }, { status: 200 });    console.error('❌ Error handling slash command:', error);

  }    return NextResponse.json({

}      response_type: "ephemeral", 

      text: "❌ An unexpected error occurred. Please try again."

// Handle GET requests (Slack sometimes sends these for verification)    }, { status: 200 });

export async function GET() {  }

  return NextResponse.json({ message: 'Slash commands endpoint is working' }, { status: 200 });}

}
// Handle GET requests (Slack sometimes sends these for verification)
export async function GET() {
  return NextResponse.json({ message: 'Slash commands endpoint is working' }, { status: 200 });
}

      case '/unmute':
        setTimeout(async () => {
          try {
            if (!isUserMuted(userId)) {
              await sendDelayedResponse(responseUrl, 'ℹ️ You are not currently muted.');
              return;
            }

            const result = unmuteUser(userId);
            if (result) {
              await sendDelayedResponse(responseUrl, `🔊 **You are now unmuted**

The AI assistant will respond to your messages again.

Welcome back! Feel free to start chatting.`);
              console.log(`✅ User ${userId} unmuted themselves`);
            } else {
              await sendDelayedResponse(responseUrl, 'Failed to unmute. Please try again.', true);
            }
          } catch (error) {
            console.error('❌ Error in /unmute command:', error);
            await sendDelayedResponse(responseUrl, 'An error occurred while unmuting.', true);
          }
        }, 50);

        return NextResponse.json({
          response_type: "ephemeral",
          text: "🔄 Unmuting your interactions..."
        }, { status: 200 });

      case '/help':
        return NextResponse.json({
          response_type: "ephemeral",
          text: `🤖 **Zen-AI Bot Commands**

**Conversation Management:**
• \`/clear\` - Clear conversation history
• \`/new-chat\` - Start a fresh conversation
• \`/stats\` - View conversation statistics

**Account Management:**
• \`/delete-data confirm\` - Permanently delete all your data
• \`/mute\` - Mute AI responses (bot won't respond to you)
• \`/unmute\` - Re-enable AI responses

**Other:**
• \`/help\` - Show this help message

**Features:**
✅ Multi-language support (responds in your language)
✅ Conversation history and context
✅ Emoji reaction sentiment analysis
✅ Works in channels and DMs

Need help? Just @mention me with your question! 💬`
        }, { status: 200 });

      case '/stats':
        setTimeout(async () => {
          try {
            const user = await getOrCreateUser(userId);
            if (!user) {
              await sendDelayedResponse(responseUrl, 'Error finding your user account.', true);
              return;
            }
            
            const conversation = await getOrCreateConversation(user.id, channelId);
            if (!conversation) {
              await sendDelayedResponse(responseUrl, 'No conversation found.', true);
              return;
            }
            
            const stats = await getConversationStats(conversation.id);
            if (!stats) {
              await sendDelayedResponse(responseUrl, 'Unable to retrieve statistics.', true);
              return;
            }

            await sendDelayedResponse(responseUrl, `� **Conversation Statistics**

�💬 **Messages:** ${stats.messageCount} total
🗓️ **Created:** ${new Date(conversation.created_at).toLocaleDateString()}
📝 **Title:** ${conversation.conversation_title || 'Untitled'}
🆔 **Conversation ID:** \`${conversation.id}\`

${stats.messageCount > 0 ? '✅ Active conversation with history' : '📝 New conversation - no messages yet'}`);
          } catch (error) {
            console.error('❌ Error in /stats command:', error);
            await sendDelayedResponse(responseUrl, 'An error occurred while retrieving statistics.', true);
          }
        }, 50);

        return NextResponse.json({
          response_type: "ephemeral",
          text: "📊 Retrieving your conversation statistics..."
        }, { status: 200 });

      default:
        // Unknown command
        console.log('❌ Unknown command:', command);
        return NextResponse.json({
          response_type: "ephemeral",
          text: `❌ Unknown command: ${command}

Available commands:
• \`/clear\` - Clear conversation history
• \`/new-chat\` - Start a new conversation  
• \`/delete-data confirm\` - Delete all your data
• \`/mute\` - Mute AI responses
• \`/unmute\` - Unmute AI responses`
        }, { status: 200 });
    }

  } catch (error) {
    console.error('❌ Error handling slash command:', error);
    return NextResponse.json({
      response_type: "ephemeral", 
      text: "❌ An unexpected error occurred. Please try again."
    }, { status: 200 });
  }
}

// Handle GET requests (Slack sometimes sends these for verification)
export async function GET() {
  return NextResponse.json({ message: 'Slash commands endpoint is working' }, { status: 200 });
}