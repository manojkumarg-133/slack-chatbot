import { NextRequest, NextResponse } from 'next/server';import { NextRequest, NextResponse } from 'next/server';import { NextRequest, NextResponse } from 'next/server';import { NextRequest, NextResponse } from 'next/server';

import { 

  getOrCreateUser, import { 

  getOrCreateConversation,

} from '@/lib/database';  getOrCreateUser, import { import { 

import { 

  clearConversation,  getOrCreateConversation,

  createNewConversationForUser,

  deleteConversationData,} from '@/lib/database';  getOrCreateUser,   getOrCreateUser, 

  getConversationStats,

} from '@/lib/slashCommands';import { 



// Helper function to send delayed responses using response_url  clearConversation,  getOrCreateConversation,  getOrCreateConversation,

async function sendDelayedResponse(responseUrl: string, message: string, isError = false) {

  try {  createNewConversationForUser,

    await fetch(responseUrl, {

      method: 'POST',  deleteConversationData,} from '@/lib/database';} from '@/lib/database';

      headers: {

        'Content-Type': 'application/json',  getConversationStats,

      },

      body: JSON.stringify({} from '@/lib/slashCommands';import { import { 

        response_type: 'ephemeral',

        text: isError ? `❌ ${message}` : message

      }),

    });// Helper function to send delayed responses using response_url  clearConversation,  clearConversation,

  } catch (error) {

    console.error('Error sending delayed response:', error);async function sendDelayedResponse(responseUrl: string, message: string, isError = false) {

  }

}  try {  createNewConversationForUser,  createNewConversationForUser,



export async function POST(request: NextRequest) {    await fetch(responseUrl, {

  try {

    console.log('🔍 Incoming slash command request');      method: 'POST',  deleteConversationData,  deleteConversationData,

    

    const body = await request.text();      headers: {

    

    if (!body) {        'Content-Type': 'application/json',  getConversationStats,  getConversationStats,

      console.log('⚠️ Empty request body');

      return NextResponse.json({ ok: true }, { status: 200 });      },

    }

          body: JSON.stringify({  muteUser,  muteUser,

    // Parse the form data

    const params = new URLSearchParams(body);        response_type: 'ephemeral',

    const command = params.get('command');

    const text = params.get('text') || '';        text: isError ? `❌ ${message}` : message  unmuteUser,  unmuteUser,

    const userId = params.get('user_id');

    const channelId = params.get('channel_id');      }),

    const responseUrl = params.get('response_url');

        });  isUserMuted  isUserMuted

    console.log('📨 Received slash command:', command);

    console.log('👤 User ID:', userId);  } catch (error) {



    // Verify the request is from Slack    console.error('Error sending delayed response:', error);} from '@/lib/slashCommands';} from '@/lib/slashCommands';

    if (!userId || !channelId || !command || !responseUrl) {

      console.log('❌ Invalid request - missing required fields');  }

      return NextResponse.json(

        { }

          response_type: "ephemeral",

          text: "❌ Invalid request. Please try again." 

        },

        { status: 200 }export async function POST(request: NextRequest) {// Helper function to send delayed responses using response_url// Helper function to send delayed responses using response_url

      );

    }  try {



    // Handle different commands and respond immediately to avoid timeout    console.log('🔍 Incoming slash command request');async function sendDelayedResponse(responseUrl: string, message: string, isError = false) {async function sendDelayedResponse(responseUrl: string, message: string, isError = false) {

    switch (command) {

      case '/clear':    

        // Clear messages from screen only, keep database intact

        setTimeout(async () => {    const body = await request.text();  try {  try {

          try {

            const user = await getOrCreateUser(userId);    

            const conversation = await getOrCreateConversation(user.id, channelId);

    if (!body) {    await fetch(responseUrl, {    await fetch(responseUrl, {

            const stats = await getConversationStats(conversation.id);

            if (!stats || stats.messageCount === 0) {      console.log('⚠️ Empty request body');

              await sendDelayedResponse(responseUrl, 'ℹ️ No messages to clear. Your chat is already empty!');

              return;      return NextResponse.json({ ok: true }, { status: 200 });      method: 'POST',      method: 'POST',

            }

    }

            const result = await clearConversation(conversation.id, false); // false = screen only

                      headers: {      headers: {

            if (result) {

              await sendDelayedResponse(responseUrl, `🧹 **Chat Cleared!**    // Parse the form data



📊 Cleared ${stats.messageCount} messages from this conversation.    const params = new URLSearchParams(body);        'Content-Type': 'application/json',        'Content-Type': 'application/json',



Your conversation history has been reset. Future messages will start a fresh conversation with context.`);    const command = params.get('command');

              console.log(`✅ User ${userId} cleared conversation ${conversation.id}`);

            } else {    const text = params.get('text') || '';      },      },

              await sendDelayedResponse(responseUrl, 'Failed to clear chat. Please try again.', true);

            }    const userId = params.get('user_id');

          } catch (error) {

            console.error('❌ Error in /clear command:', error);    const channelId = params.get('channel_id');      body: JSON.stringify({      body: JSON.stringify({

            await sendDelayedResponse(responseUrl, 'An error occurred while clearing the chat.', true);

          }    const responseUrl = params.get('response_url');

        }, 50);

            response_type: 'ephemeral',        response_type: 'ephemeral',

        return NextResponse.json({

          response_type: "ephemeral",    console.log('📨 Received slash command:', command);

          text: "🔄 Clearing your conversation history..."

        }, { status: 200 });    console.log('👤 User ID:', userId);        text: isError ? `❌ ${message}` : message



      case '/new-chat':

        setTimeout(async () => {

          try {    // Verify the request is from Slack      }),  } catch (error) {        text: isError ? `❌ ${message}` : message

            const user = await getOrCreateUser(userId);

            const newConversationId = await createNewConversationForUser(user.id, channelId);    if (!userId || !channelId || !command || !responseUrl) {

            

            if (newConversationId) {      console.log('❌ Invalid request - missing required fields');    });

              await sendDelayedResponse(responseUrl, `🆕 **New Chat Started!**

      return NextResponse.json(

🆔 Conversation ID: \`${newConversationId}\`

        {   } catch (error) {    console.error('Error sending delayed response:', error);      }),

Your conversation history has been reset. This is now a fresh conversation with the AI assistant.`);

              console.log(`✅ User ${userId} started new conversation ${newConversationId}`);          response_type: "ephemeral",

            } else {

              await sendDelayedResponse(responseUrl, 'Failed to start new chat. Please try again.', true);          text: "❌ Invalid request. Please try again."     console.error('Error sending delayed response:', error);

            }

          } catch (error) {        },

            console.error('❌ Error in /new-chat command:', error);

            await sendDelayedResponse(responseUrl, 'An error occurred while starting new chat.', true);        { status: 200 }  }  }    });

          }

        }, 50);      );



        return NextResponse.json({    }}

          response_type: "ephemeral",

          text: "🔄 Starting a new chat conversation..."

        }, { status: 200 });

    // Handle different commands and respond immediately to avoid timeout}  } catch (error) {

      case '/delete':

        setTimeout(async () => {    switch (command) {

          try {

            const user = await getOrCreateUser(userId);      case '/clear':export async function POST(request: NextRequest) {

            const conversation = await getOrCreateConversation(user.id, channelId);

        // Clear messages from screen only, keep database intact

            const stats = await getConversationStats(conversation.id);

            const success = await deleteConversationData(conversation.id);        setTimeout(async () => {  try {    console.error('Error sending delayed response:', error);

            

            if (success) {          try {

              await sendDelayedResponse(responseUrl, `🗑️ **Conversation Deleted**

            const user = await getOrCreateUser(userId);    console.log('🔍 Incoming slash command request');

🗑️ Deleted from screen and database:

• ${stats?.messageCount || 0} messages            const conversation = await getOrCreateConversation(user.id, channelId);

• ${stats?.responseCount || 0} responses  

• ${stats?.reactionCount || 0} reactions    export async function POST(request: NextRequest) {  }



Your conversation has been completely removed.`);            const stats = await getConversationStats(conversation.id);

              console.log(`✅ User ${userId} deleted conversation data`);

            } else {            if (!stats || stats.messageCount === 0) {    const body = await request.text();

              await sendDelayedResponse(responseUrl, 'Failed to delete conversation. Please try again.', true);

            }              await sendDelayedResponse(responseUrl, 'ℹ️ No messages to clear. Your chat is already empty!');

          } catch (error) {

            console.error('❌ Error in /delete command:', error);              return;      try {}

            await sendDelayedResponse(responseUrl, 'An error occurred while deleting the conversation.', true);

          }            }

        }, 50);

    if (!body) {

        return NextResponse.json({

          response_type: "ephemeral",            const result = await clearConversation(conversation.id, false); // false = screen only

          text: "🗑️ Deleting conversation from screen and database..."

        }, { status: 200 });                  console.log('⚠️ Empty request body');    console.log('🔍 Incoming slash command request');



      case '/help':            if (result) {

        return NextResponse.json({

          response_type: "ephemeral",              await sendDelayedResponse(responseUrl, `🧹 **Chat Cleared!**      return NextResponse.json({ ok: true }, { status: 200 });

          text: `🤖 **Zen-AI Bot Commands**



**Available Commands:**

• \`/clear\` - Clear messages from screen (keeps database)📊 Cleared ${stats.messageCount} messages from this conversation.    }    export async function POST(request: NextRequest) {

• \`/delete\` - Delete conversation from screen AND database  

• \`/new-chat\` - Start a fresh conversation with new ID

• \`/help\` - Show this help message

Your conversation history has been reset. Future messages will start a fresh conversation with context.`);    

**Features:**

✅ Multi-language support (responds in your language)              console.log(`✅ User ${userId} cleared conversation ${conversation.id}`);

✅ Conversation history and context

✅ Emoji reaction sentiment analysis            } else {    // Parse the form data    const body = await request.text();  try {

✅ Works in channels and DMs

              await sendDelayedResponse(responseUrl, 'Failed to clear chat. Please try again.', true);

Need help? Just @mention me with your question! 💬`

        }, { status: 200 });            }    const params = new URLSearchParams(body);



      default:          } catch (error) {

        return NextResponse.json({

          response_type: "ephemeral",            console.error('❌ Error in /clear command:', error);    const command = params.get('command');        console.log('🔍 Incoming slash command request');

          text: `❓ **Unknown Command: \`${command}\`**

            await sendDelayedResponse(responseUrl, 'An error occurred while clearing the chat.', true);

Available commands:

• \`/clear\` - Clear messages from screen only          }    const text = params.get('text') || '';

• \`/delete\` - Delete conversation completely

• \`/new-chat\` - Start a new conversation        }, 50);

• \`/help\` - Show help message`

        }, { status: 200 });    const userId = params.get('user_id');    if (!body) {    

    }

        return NextResponse.json({

  } catch (error) {

    console.error('❌ Error handling slash command:', error);          response_type: "ephemeral",    const channelId = params.get('channel_id');

    return NextResponse.json({

      response_type: "ephemeral",           text: "🔄 Clearing your conversation history..."

      text: "❌ An unexpected error occurred. Please try again."

    }, { status: 200 });        }, { status: 200 });    const responseUrl = params.get('response_url');      console.log('⚠️ Empty request body');    const body = await request.text();

  }

}



// Handle GET requests (Slack sometimes sends these for verification)      case '/new-chat':    

export async function GET() {

  return NextResponse.json({ message: 'Slash commands endpoint is working' }, { status: 200 });        // Clear screen and create new conversation ID

}
        setTimeout(async () => {    console.log('📨 Received slash command:', command);      return NextResponse.json({ ok: true }, { status: 200 });    

          try {

            const user = await getOrCreateUser(userId);    console.log('👤 User ID:', userId);

            const newConversationId = await createNewConversationForUser(user.id, channelId);

                }    if (!body) {

            if (newConversationId) {

              await sendDelayedResponse(responseUrl, `🆕 **New Chat Started!**    // Verify the request is from Slack



🆔 Conversation ID: \`${newConversationId}\`    if (!userId || !channelId || !command || !responseUrl) {          console.log('⚠️ Empty request body');



Your conversation history has been reset. This is now a fresh conversation with the AI assistant.`);      console.log('❌ Invalid request - missing required fields');

              console.log(`✅ User ${userId} started new conversation ${newConversationId}`);

            } else {      return NextResponse.json(    // Parse the form data      return NextResponse.json({ ok: true }, { status: 200 });

              await sendDelayedResponse(responseUrl, 'Failed to start new chat. Please try again.', true);

            }        { 

          } catch (error) {

            console.error('❌ Error in /new-chat command:', error);          response_type: "ephemeral",    const params = new URLSearchParams(body);    }

            await sendDelayedResponse(responseUrl, 'An error occurred while starting new chat.', true);

          }          text: "❌ Invalid request. Please try again." 

        }, 50);

        },    const command = params.get('command');    

        return NextResponse.json({

          response_type: "ephemeral",        { status: 200 }

          text: "🔄 Starting a new chat conversation..."

        }, { status: 200 });      );    const text = params.get('text') || '';    // Parse the form data



      case '/delete':    }

        // Delete everything: screen messages AND database records

        setTimeout(async () => {    const userId = params.get('user_id');    const params = new URLSearchParams(body);

          try {

            const user = await getOrCreateUser(userId);    // Handle different commands and respond immediately to avoid timeout

            const conversation = await getOrCreateConversation(user.id, channelId);

    switch (command) {    const channelId = params.get('channel_id');    const command = params.get('command');

            const stats = await getConversationStats(conversation.id);

            const success = await deleteConversationData(conversation.id);      case '/clear':

            

            if (success) {        // Clear messages from screen only, keep database intact    const responseUrl = params.get('response_url');    const text = params.get('text') || '';

              await sendDelayedResponse(responseUrl, `🗑️ **Conversation Deleted**

        setTimeout(async () => {

🗑️ Deleted from screen and database:

• ${stats?.messageCount || 0} messages          try {        const userId = params.get('user_id');

• ${stats?.responseCount || 0} responses  

• ${stats?.reactionCount || 0} reactions            const user = await getOrCreateUser(userId);



Your conversation has been completely removed.`);            const conversation = await getOrCreateConversation(user.id, channelId);    console.log('📨 Received slash command:', command);    const channelId = params.get('channel_id');

              console.log(`✅ User ${userId} deleted conversation data`);

            } else {

              await sendDelayedResponse(responseUrl, 'Failed to delete conversation. Please try again.', true);

            }            const stats = await getConversationStats(conversation.id);    console.log('👤 User ID:', userId);    const responseUrl = params.get('response_url');

          } catch (error) {

            console.error('❌ Error in /delete command:', error);            if (!stats || stats.messageCount === 0) {

            await sendDelayedResponse(responseUrl, 'An error occurred while deleting the conversation.', true);

          }              await sendDelayedResponse(responseUrl, 'ℹ️ No messages to clear. Your chat is already empty!');    

        }, 50);

              return;

        return NextResponse.json({

          response_type: "ephemeral",            }    // Verify the request is from Slack    console.log('📨 Received slash command:', command);

          text: "🗑️ Deleting conversation from screen and database..."

        }, { status: 200 });



      case '/help':            const result = await clearConversation(conversation.id, false); // false = screen only    if (!userId || !channelId || !command || !responseUrl) {    console.log('👤 User ID:', userId);

        return NextResponse.json({

          response_type: "ephemeral",            

          text: `🤖 **Zen-AI Bot Commands**

            if (result) {      console.log('❌ Invalid request - missing required fields');

**Available Commands:**

• \`/clear\` - Clear messages from screen (keeps database)              await sendDelayedResponse(responseUrl, `🧹 **Chat Cleared!**

• \`/delete\` - Delete conversation from screen AND database  

• \`/new-chat\` - Start a fresh conversation with new ID      return NextResponse.json(    // Verify the request is from Slack

• \`/help\` - Show this help message

📊 Cleared ${stats.messageCount} messages from this conversation.

**Features:**

✅ Multi-language support (responds in your language)        {     if (!userId || !channelId || !command || !responseUrl) {

✅ Conversation history and context

✅ Emoji reaction sentiment analysisYour conversation history has been reset. Future messages will start a fresh conversation with context.`);

✅ Works in channels and DMs

              console.log(`✅ User ${userId} cleared conversation ${conversation.id}`);          response_type: "ephemeral",      console.log('❌ Invalid request - missing required fields');

Need help? Just @mention me with your question! 💬`

        }, { status: 200 });            } else {



      default:              await sendDelayedResponse(responseUrl, 'Failed to clear chat. Please try again.', true);          text: "❌ Invalid request. Please try again."       return NextResponse.json(

        return NextResponse.json({

          response_type: "ephemeral",            }

          text: `❓ **Unknown Command: \`${command}\`**

          } catch (error) {        },         { 

Available commands:

• \`/clear\` - Clear messages from screen only            console.error('❌ Error in /clear command:', error);

• \`/delete\` - Delete conversation completely

• \`/new-chat\` - Start a new conversation            await sendDelayedResponse(responseUrl, 'An error occurred while clearing the chat.', true);        { status: 200 }          response_type: "ephemeral",

• \`/help\` - Show help message`

        }, { status: 200 });          }

    }

        }, 50);      );          text: "❌ Invalid request. Please try again." 

  } catch (error) {

    console.error('❌ Error handling slash command:', error);

    return NextResponse.json({

      response_type: "ephemeral",         return NextResponse.json({    }        }, 

      text: "❌ An unexpected error occurred. Please try again."

    }, { status: 200 });          response_type: "ephemeral",

  }

}          text: "🔄 Clearing your conversation history..."        { status: 200 }



// Handle GET requests (Slack sometimes sends these for verification)        }, { status: 200 });

export async function GET() {

  return NextResponse.json({ message: 'Slash commands endpoint is working' }, { status: 200 });    // Handle different commands and respond immediately to avoid timeout      );

}
      case '/new-chat':

        // Clear screen and create new conversation ID    switch (command) {    }

        setTimeout(async () => {

          try {      case '/clear':

            const user = await getOrCreateUser(userId);

            const newConversationId = await createNewConversationForUser(user.id, channelId);        setTimeout(async () => {    // Handle different commands and respond immediately to avoid timeout

            

            if (newConversationId) {          try {    switch (command) {

              await sendDelayedResponse(responseUrl, `🆕 **New Chat Started!**

            const user = await getOrCreateUser(userId);      case '/clear':

🆔 Conversation ID: \`${newConversationId}\`

            if (!user) {        // Acknowledge immediately (within 3 seconds)

Your conversation history has been reset. This is now a fresh conversation with the AI assistant.`);

              console.log(`✅ User ${userId} started new conversation ${newConversationId}`);              await sendDelayedResponse(responseUrl, 'Error finding your user account.', true);        setTimeout(async () => {

            } else {

              await sendDelayedResponse(responseUrl, 'Failed to start new chat. Please try again.', true);              return;          try {

            }

          } catch (error) {            }            const user = await getOrCreateUser(userId);

            console.error('❌ Error in /new-chat command:', error);

            await sendDelayedResponse(responseUrl, 'An error occurred while starting new chat.', true);                        if (!user) {

          }

        }, 50);            const conversation = await getOrCreateConversation(user.id, channelId);              await sendDelayedResponse(responseUrl, 'Error finding your user account.', true);



        return NextResponse.json({            if (!conversation) {              return;

          response_type: "ephemeral",

          text: "🔄 Starting a new chat conversation..."              await sendDelayedResponse(responseUrl, 'No conversation found.', true);            }

        }, { status: 200 });

              return;            

      case '/delete':

        // Delete everything: screen messages AND database records            }            const conversation = await getOrCreateConversation(user.id, channelId);

        setTimeout(async () => {

          try {                        if (!conversation) {

            const user = await getOrCreateUser(userId);

            const conversation = await getOrCreateConversation(user.id, channelId);            const stats = await getConversationStats(conversation.id);              await sendDelayedResponse(responseUrl, 'No conversation found.', true);



            const stats = await getConversationStats(conversation.id);            if (!stats || stats.messageCount === 0) {              return;

            const success = await deleteConversationData(conversation.id);

                          await sendDelayedResponse(responseUrl, 'ℹ️ No messages to clear. Your chat is already empty!');            }

            if (success) {

              await sendDelayedResponse(responseUrl, `🗑️ **Conversation Deleted**              return;            



🗑️ Deleted from screen and database:            }            const stats = await getConversationStats(conversation.id);

• ${stats?.messageCount || 0} messages

• ${stats?.responseCount || 0} responses              if (!stats || stats.messageCount === 0) {

• ${stats?.reactionCount || 0} reactions

            const result = await clearConversation(conversation.id);              await sendDelayedResponse(responseUrl, 'ℹ️ No messages to clear. Your chat is already empty!');

Your conversation has been completely removed.`);

              console.log(`✅ User ${userId} deleted conversation data`);            if (result) {              return;

            } else {

              await sendDelayedResponse(responseUrl, 'Failed to delete conversation. Please try again.', true);              await sendDelayedResponse(responseUrl, `✅ **Screen Cleared!**            }

            }

          } catch (error) {

            console.error('❌ Error in /delete command:', error);

            await sendDelayedResponse(responseUrl, 'An error occurred while deleting the conversation.', true);📊 Cleared ${stats.messageCount} messages from screen view.            const result = await clearConversation(conversation.id);

          }

        }, 50);            if (result) {



        return NextResponse.json({💾 Database kept intact - conversation continues with same ID.`);              await sendDelayedResponse(responseUrl, `✅ **Chat Cleared!**

          response_type: "ephemeral",

          text: "🗑️ Deleting conversation from screen and database..."              console.log(`✅ User ${userId} cleared screen for conversation ${conversation.id}`);

        }, { status: 200 });

            } else {📊 Cleared ${stats.messageCount} messages from this conversation.

      case '/help':

        return NextResponse.json({              await sendDelayedResponse(responseUrl, 'Failed to clear chat. Please try again.', true);

          response_type: "ephemeral",

          text: `🤖 **Zen-AI Bot Commands**            }Your conversation history has been reset. Future messages will start a fresh conversation with context.`);



**Available Commands:**          } catch (error) {              console.log(`✅ User ${userId} cleared conversation ${conversation.id}`);

• \`/clear\` - Clear messages from screen (keeps database)

• \`/delete\` - Delete conversation from screen AND database              console.error('❌ Error in /clear command:', error);            } else {

• \`/new-chat\` - Start a fresh conversation with new ID

• \`/help\` - Show this help message            await sendDelayedResponse(responseUrl, 'An error occurred while clearing the chat.', true);              await sendDelayedResponse(responseUrl, 'Failed to clear chat. Please try again.', true);



**Features:**          }            }

✅ Multi-language support (responds in your language)

✅ Conversation history and context        }, 50);          } catch (error) {

✅ Emoji reaction sentiment analysis

✅ Works in channels and DMs            console.error('❌ Error in /clear command:', error);



Need help? Just @mention me with your question! 💬`        return NextResponse.json({            await sendDelayedResponse(responseUrl, 'An error occurred while clearing the chat.', true);

        }, { status: 200 });

          response_type: "ephemeral",          }

      default:

        return NextResponse.json({          text: "🔄 Clearing messages from screen..."        }, 50); // Reduced delay to respond faster

          response_type: "ephemeral",

          text: `❓ **Unknown Command: \`${command}\`**        }, { status: 200 });



Available commands:        return NextResponse.json({

• \`/clear\` - Clear messages from screen only

• \`/delete\` - Delete conversation completely      case '/delete':          response_type: "ephemeral",

• \`/new-chat\` - Start a new conversation

• \`/help\` - Show help message`        setTimeout(async () => {          text: "🔄 Clearing your conversation history..."

        }, { status: 200 });

    }          try {        }, { status: 200 });



  } catch (error) {            const user = await getOrCreateUser(userId);

    console.error('❌ Error handling slash command:', error);

    return NextResponse.json({            if (!user) {      case '/new-chat':

      response_type: "ephemeral", 

      text: "❌ An unexpected error occurred. Please try again."              await sendDelayedResponse(responseUrl, 'Error finding your user account.', true);        setTimeout(async () => {

    }, { status: 200 });

  }              return;          try {

}

            }            const user = await getOrCreateUser(userId);

// Handle GET requests (Slack sometimes sends these for verification)

export async function GET() {            if (!user) {

  return NextResponse.json({ message: 'Slash commands endpoint is working' }, { status: 200 });

}            const conversation = await getOrCreateConversation(user.id, channelId);              await sendDelayedResponse(responseUrl, 'Error finding your user account.', true);

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
📝 **Title:** ${conversation.title || 'Untitled'}
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