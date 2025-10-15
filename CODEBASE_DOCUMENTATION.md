# Slack Gemini Bot - Complete Codebase Documentation

## 📁 Project Structure Overview

```
slack-gemini-bot/
├── src/                           # Next.js application (legacy/backup handlers)
│   └── app/
│       └── api/
│           └── slack/
│               ├── events/route.ts    # Legacy event handler (not used in production)
│               └── commands/route.ts  # Legacy command handler (not used in production)
├── supabase/                      # Main production backend (Supabase Edge Functions)
│   ├── functions/
│   │   ├── slack-events/          # 🚀 MAIN: Handles @mentions, DMs, reactions
│   │   ├── slack-commands/        # 🚀 MAIN: Handles slash commands
│   │   └── _shared/               # Shared utilities for edge functions
│   │       ├── database.ts        # Database operations
│   │       ├── gemini.ts          # AI response generation
│   │       ├── slack.ts           # Slack API interactions
│   │       └── slashCommands.ts   # Slash command logic
│   └── config.toml                # Supabase configuration
├── lib/                           # Next.js utilities (legacy/backup)
└── package.json                   # Dependencies and scripts
```

---

## 🔄 How the Bot Works (High-Level Flow)

### 1. **User Interaction in Slack**
```
User sends message → Slack API → Supabase Edge Functions → Database → Gemini AI → Response
```

### 2. **Two Main Entry Points**
- **Events** (`slack-events`): @mentions, DMs, reactions
- **Commands** (`slack-commands`): `/clear`, `/delete`, `/new-chat`, `/help`

### 3. **Data Flow**
1. Slack sends webhook to Supabase edge function
2. Bot validates request and checks for duplicates
3. Bot retrieves/creates user and conversation in database
4. Bot gets conversation history for context
5. Bot sends request to Gemini AI with context
6. Bot saves response to database and sends to Slack

---

# 📄 File-by-File Documentation

## 🚀 PRODUCTION CODE (Supabase Edge Functions)

### 📂 `supabase/functions/slack-events/index.ts`
**Purpose**: Main handler for Slack events (@mentions, DMs, reactions)

```typescript
// Core functionality:
Deno.serve(async (req: Request): Promise<Response> => {
```

#### **Key Sections:**

**1. Request Validation & Parsing**
```typescript
// Validates Slack signature and parses webhook payload
const signature = req.headers.get('x-slack-signature');
const timestamp = req.headers.get('x-slack-request-timestamp');
const body = await req.text();

// Parses JSON event data from Slack
const { type, event, challenge } = JSON.parse(body);
```

**2. URL Challenge (Slack App Setup)**
```typescript
// Required for Slack app verification during setup
if (type === 'url_verification') {
  return new Response(challenge, { status: 200 });
}
```

**3. Event Routing**
```typescript
// Routes different Slack events to appropriate handlers
switch (event.type) {
  case 'app_mention':     // @bot mentions in channels
  case 'message':         // Direct messages to bot
  case 'reaction_added':  // Emoji reactions on messages
  case 'reaction_removed': // Emoji reactions removed
}
```

**4. Duplicate Prevention**
```typescript
// Prevents processing same event multiple times (Slack retries)
const eventKey = `${event.user}-${event.ts}-${event.type}`;
if (processedEvents.has(eventKey)) {
  return new Response('OK', { status: 200 });
}
```

**5. File/Media Upload Denial** 🚫
```typescript
// Rejects file uploads, only accepts text
if (event.files && event.files.length > 0) {
  await sendSlackMessage(
    event.channel, 
    '❌ Sorry, I can\'t access files or media. I can only process text messages.'
  );
  return new Response('OK', { status: 200 });
}
```

**6. AI Response Generation**
```typescript
// Gets conversation history and generates AI response
const history = await getConversationHistory(conversation.id, 20);
const response = await generateGeminiResponse(userMessage, history);
await sendSlackMessage(event.channel, response.text);
```

---

### 📂 `supabase/functions/slack-commands/index.ts`
**Purpose**: Handles slash commands (`/clear`, `/delete`, `/new-chat`, `/help`)

#### **Key Features:**

**1. Command Parsing**
```typescript
// Parses Slack form-encoded slash command data
const params = parseSlackRequestBody(body);
const command = params.command;      // e.g., "/clear"
const userId = params.user_id;       // Slack user ID
const channelId = params.channel_id; // Slack channel ID
const responseUrl = params.response_url; // For delayed responses
```

**2. File/Media Upload Denial** 🚫
```typescript
// Checks for file/media keywords in slash commands
const fileKeywords = ['file', 'image', 'photo', 'document', 'audio', 'video'];
const hasFileKeyword = fileKeywords.some(k => text.toLowerCase().includes(k));

if (!text || hasFileKeyword) {
  await sendDelayedResponse(
    responseUrl,
    "Sorry, I can't access files or media. I can only process text messages.",
    true
  );
  return;
}
```

**3. Command Handlers**
```typescript
switch (command) {
  case '/clear':    // Clear bot messages from screen only
  case '/delete':   // Delete entire conversation + database
  case '/new-chat': // Start fresh conversation with new ID
  case '/help':     // Show available commands
}
```

**4. Delayed Responses**
```typescript
// Slack requires immediate response, then sends actual result via webhook
return new Response(JSON.stringify({
  response_type: "ephemeral",
  text: "🔄 Processing your request..."
}));

// Actual processing happens asynchronously
setTimeout(async () => {
  await sendDelayedResponse(responseUrl, actualResult);
}, 50);
```

---

## 🛠️ SHARED UTILITIES (`supabase/functions/_shared/`)

### 📂 `database.ts`
**Purpose**: All database operations using Supabase

```typescript
// Initialize Supabase client with service role key
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
```

#### **Key Functions:**

**1. User Management**
```typescript
export async function getOrCreateUser(slackUserId: string): Promise<any> {
  // Try to find existing user by Slack ID
  const { data: existingUser } = await supabase
    .from('users')
    .select('*')
    .eq('slack_user_id', slackUserId)
    .single();

  if (existingUser) return existingUser;

  // Create new user if not found
  const { data: newUser } = await supabase
    .from('users')
    .insert({ slack_user_id: slackUserId })
    .select()
    .single();

  return newUser;
}
```

**2. Conversation Management**
```typescript
export async function getOrCreateConversation(
  userId: string, 
  channelId: string
): Promise<any> {
  // Find existing conversation for user in this channel
  // Create new one if not found
  // Maintains conversation continuity
}
```

**3. Message History**
```typescript
export async function getConversationHistory(
  conversationId: string, 
  limit: number = 20
): Promise<any[]> {
  // Retrieves recent messages for AI context
  // Includes user queries and bot responses
  // Orders by timestamp for chronological context
}
```

**4. Message Storage**
```typescript
export async function createUserQuery(
  conversationId: string,
  content: string,
  slackTs: string
): Promise<any> {
  // Saves user message to database
  // Links to conversation and Slack timestamp
}

export async function createBotResponse(responseData: any): Promise<any> {
  // Saves bot response to database
  // Includes AI model info, tokens used, processing time
}
```

**5. Reaction Tracking**
```typescript
export async function addMessageReaction(
  messageId: string,
  emoji: string,
  userId: string
): Promise<any> {
  // Records emoji reactions for sentiment analysis
  // Used by AI for emotional context
}
```

---

### 📂 `gemini.ts`
**Purpose**: AI response generation using Google Gemini

#### **Initialization**
```typescript
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export function isGeminiInitialized(): boolean {
  return !!apiKey; // Checks if API key is configured
}
```

#### **AI Response Generation**
```typescript
export async function generateGeminiResponse(
  userMessage: string,
  conversationHistory: any[] = [],
  modelName: string = 'gemini-2.0-flash'
): Promise<{
  text: string;
  error?: string;
  tokensUsed?: number;
  processingTime: number;
}> {
```

**Key Features:**
1. **Context Building**: Converts conversation history into AI-readable format
2. **Multi-language Support**: Responds in user's detected language
3. **Reaction Context**: Includes emoji reactions for emotional understanding
4. **Error Handling**: Graceful fallbacks for API failures
5. **Performance Tracking**: Measures response time and token usage

---

### 📂 `slack.ts`
**Purpose**: All Slack API interactions

#### **Core Functions:**

**1. Send Messages**
```typescript
export async function sendSlackMessage(
  channel: string,
  text: string,
  threadTs?: string
): Promise<{ ok: boolean; ts?: string }> {
  // Sends message to Slack channel/DM
  // Handles threading for replies
  // Returns message timestamp for updates
}
```

**2. Update Messages**
```typescript
export async function updateSlackMessage(
  channel: string,
  ts: string,
  text: string
): Promise<boolean> {
  // Updates existing message (e.g., "Thinking..." → actual response)
  // Used for seamless user experience
}
```

**3. Clear Messages**
```typescript
export async function clearScreenMessages(
  channel: string,
  slackToken: string
): Promise<boolean> {
  // Deletes bot's own messages from screen
  // Cannot delete user messages (Slack limitation)
  // Used by /clear command
}
```

**4. User Info**
```typescript
export async function getSlackUserInfo(userId: string): Promise<any> {
  // Fetches user profile from Slack API
  // Gets display name, email, timezone, avatar
  // Used for personalizing database records
}
```

**5. Delayed Responses**
```typescript
export async function sendDelayedResponse(
  responseUrl: string,
  message: string,
  isError: boolean = false
): Promise<boolean> {
  // Sends response via Slack's response_url webhook
  // Required for slash commands (3-second timeout)
  // Allows processing time for complex operations
}
```

---

### 📂 `slashCommands.ts`
**Purpose**: Business logic for slash commands

#### **Key Functions:**

**1. Conversation Management**
```typescript
export async function clearConversation(conversationId: string): Promise<boolean> {
  // Soft delete: marks messages as deleted but preserves for context
  // Used by /clear command
}

export async function deleteConversationFromDatabase(conversationId: string): Promise<boolean> {
  // Hard delete: permanently removes all conversation data
  // Used by /delete command
}

export async function createNewConversationForUser(
  userId: string, 
  channelId: string
): Promise<string | null> {
  // Creates fresh conversation with new UUID
  // Used by /new-chat command
}
```

**2. Statistics**
```typescript
export async function getConversationStats(conversationId: string): Promise<{
  messageCount: number;
  lastActivity: string;
}> {
  // Provides conversation metrics for user feedback
  // Used in command responses
}
```

**3. User Controls**
```typescript
export async function muteUser(userId: string): Promise<boolean> {
export async function unmuteUser(userId: string): Promise<boolean> {
export async function isUserMuted(userId: string): Promise<boolean> {
  // User muting functionality (future feature)
}
```

---

## 🗄️ DATABASE SCHEMA

### **Tables:**

**1. `users`**
```sql
- id (UUID, primary key)
- slack_user_id (text, unique) -- Slack user ID
- display_name (text)
- email (text)
- timezone (text)
- avatar_url (text)
- created_at (timestamp)
- updated_at (timestamp)
```

**2. `conversations`**
```sql
- id (UUID, primary key)
- user_id (UUID, foreign key → users.id)
- slack_channel_id (text) -- Slack channel/DM ID
- slack_thread_ts (text) -- Thread timestamp (if in thread)
- conversation_title (text) -- AI-generated title
- created_at (timestamp)
- updated_at (timestamp)
```

**3. `user_queries`**
```sql
- id (UUID, primary key)
- conversation_id (UUID, foreign key → conversations.id)
- content (text) -- User's message
- slack_message_ts (text) -- Slack message timestamp
- created_at (timestamp)
```

**4. `bot_responses`**
```sql
- id (UUID, primary key)
- query_id (UUID, foreign key → user_queries.id)
- content (text) -- Bot's response
- slack_message_ts (text) -- Slack message timestamp
- model_used (text) -- AI model name
- tokens_used (integer)
- processing_time_ms (integer)
- error_message (text) -- If response failed
- created_at (timestamp)
```

**5. `message_reactions`**
```sql
- id (UUID, primary key)
- message_id (UUID) -- Links to user_queries or bot_responses
- message_type (text) -- 'user_query' or 'bot_response'
- emoji (text) -- Reaction emoji name
- user_id (UUID, foreign key → users.id)
- slack_reaction_ts (text) -- When reaction was added
- created_at (timestamp)
```

---

## 🔧 CONFIGURATION

### **Environment Variables (Supabase):**
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
GEMINI_API_KEY=your-gemini-api-key
```

### **Slack App Configuration:**
```
Event Subscriptions:
  Request URL: https://your-project.supabase.co/functions/v1/slack-events
  
  Subscribe to Bot Events:
    - app_mention (when bot is @mentioned)
    - message.im (direct messages to bot)
    - reaction_added (emoji reactions)
    - reaction_removed (emoji reactions removed)

Slash Commands:
  Request URL: https://your-project.supabase.co/functions/v1/slack-commands
  
  Commands:
    /clear - Clear bot messages from screen
    /delete - Delete entire conversation
    /new-chat - Start fresh conversation
    /help - Show available commands

OAuth Scopes:
  - app_mentions:read
  - channels:history
  - chat:write
  - im:history
  - im:write
  - reactions:read
  - users:read
```

---

## 🔄 EVENT FLOW EXAMPLES

### **Example 1: User @mentions bot with question**
```
1. User: "@Zen-AI What's the weather like?"
2. Slack → POST /functions/v1/slack-events
3. Event type: 'app_mention'
4. Bot checks for duplicates
5. Bot validates no file uploads
6. Bot gets/creates user in database
7. Bot gets/creates conversation
8. Bot retrieves last 20 messages for context
9. Bot sends "🤔 Thinking..." message
10. Bot calls Gemini AI with context
11. Bot updates message with AI response
12. Bot saves query + response to database
```

### **Example 2: User uploads image with @mention**
```
1. User: "@Zen-AI [image attached]"
2. Slack → POST /functions/v1/slack-events
3. Event has 'files' array with image data
4. Bot detects file upload
5. Bot responds: "❌ Sorry, I can't access files or media. I can only process text messages."
6. Bot exits without processing further
```

### **Example 3: User runs /clear command**
```
1. User: "/clear"
2. Slack → POST /functions/v1/slack-commands
3. Bot responds immediately: "🔄 Clearing messages..."
4. Bot starts async processing
5. Bot gets user's conversation
6. Bot calls Slack API to delete its own messages
7. Bot sends delayed response: "🧹 Bot messages cleared!"
```

---

## 🚦 ERROR HANDLING

### **Common Error Scenarios:**

**1. Duplicate Events**
- Slack retries failed webhooks
- Bot tracks processed events in memory
- Prevents duplicate responses

**2. Database Errors**
- Graceful fallbacks when DB is unavailable
- Error messages to user instead of crashes
- Retry logic for temporary failures

**3. AI API Errors**
- Timeout handling for slow AI responses
- Fallback messages when AI is unavailable
- Token limit handling

**4. Slack API Errors**
- Rate limiting compliance
- Permission error handling
- Network failure recovery

---

## 🔒 SECURITY FEATURES

### **1. Request Validation**
```typescript
// Verifies requests actually come from Slack
const signature = req.headers.get('x-slack-signature');
const timestamp = req.headers.get('x-slack-request-timestamp');
// HMAC signature verification (simplified in example)
```

### **2. File Upload Blocking**
```typescript
// Multiple layers of protection against file uploads
if (event.files || event.attachments || hasFileKeywords) {
  // Reject and inform user
}
```

### **3. User Muting**
```typescript
// Admins can mute problematic users
if (isUserMuted(userId)) {
  return; // Silent ignore
}
```

### **4. Rate Limiting**
- Duplicate event prevention
- User processing locks
- Conversation-level locking

---

## 🚀 DEPLOYMENT

### **Supabase Edge Functions:**
```bash
# Deploy all functions
supabase functions deploy

# Deploy specific function
supabase functions deploy slack-events
supabase functions deploy slack-commands
```

### **Environment Setup:**
```bash
# Set environment variables
supabase secrets set SLACK_BOT_TOKEN=xoxb-...
supabase secrets set SLACK_SIGNING_SECRET=...
supabase secrets set GEMINI_API_KEY=...
```

---

## 📊 MONITORING & LOGGING

### **Key Metrics:**
- Response time per message
- AI token usage
- Database query performance
- Error rates by type
- User engagement stats

### **Log Levels:**
- `INFO`: Normal operations, user interactions
- `WARN`: Recoverable errors, rate limits
- `ERROR`: Critical failures, data corruption
- `DEBUG`: Detailed troubleshooting info

---

## 🔮 FUTURE ENHANCEMENTS

### **Planned Features:**
1. **Multi-threaded Conversations**: Better thread support
2. **Rich Media Responses**: Images, links, formatting
3. **Custom AI Personalities**: Different bot behaviors
4. **Analytics Dashboard**: Usage statistics
5. **Admin Commands**: User management, system stats
6. **File Processing**: Safe document analysis
7. **Integration APIs**: Connect to external services

---

This documentation covers the complete codebase. The bot is production-ready with robust error handling, security features, and scalable architecture using Supabase Edge Functions.