# Slack-Gemini Bot: Complete Technical Documentation

## 📋 Project Overview

This is a comprehensive Slack bot powered by Google Gemini AI that provides intelligent conversational responses in a centralized database system. The bot supports multi-language conversations, emoji reaction sentiment analysis, and maintains conversation context across sessions.

### 🏗️ Architecture
- **Platform**: Supabase Edge Functions (Deno runtime)
- **Database**: PostgreSQL (Supabase) with centralized schema
- **AI Model**: Google Gemini 2.5-flash
- **Framework**: TypeScript with Deno
- **API**: Slack Events API and Slash Commands

### 🔗 System Integration
The bot uses a centralized database design that can support multiple chat platforms (currently Slack, expandable to Discord, Teams, etc.). All conversations and user data are stored in a unified schema.

---

## 📁 File Structure & Documentation

### `supabase/functions/_shared/centralized-database.ts`

**Purpose**: Core database operations layer that handles all data persistence for the multi-platform chat system.

**Dependencies**: 
- `supabaseClient.ts` - Database connection
- `centralized-database.types.ts` - TypeScript interfaces

#### Key Types and Interfaces

```typescript
interface User {
  id: string;                    // UUID primary key
  platform_type: string;        // 'slack', 'discord', 'teams', etc.
  platform_user_id: string;     // User ID from the platform
  display_name: string | null;  // User's display name
  email: string | null;         // User's email address
  timezone: string | null;      // User's timezone
  avatar_url: string | null;    // Profile picture URL
  created_at: string;           // Account creation timestamp
  updated_at: string;           // Last update timestamp
}

interface Conversation {
  id: string;                    // UUID primary key
  user_id: string;              // References users.id
  platform_type: string;        // 'slack', 'discord', etc.
  platform_conversation_id: string; // Channel/thread ID from platform
  title: string | null;         // Conversation title (auto-generated)
  created_at: string;           // Conversation start time
  updated_at: string;           // Last activity time
  is_archived: boolean;         // Soft delete flag
}

interface UserQuery {
  id: string;                    // UUID primary key
  conversation_id: string;       // References conversations.id
  user_id: string;              // References users.id
  content: string;              // User's message content
  platform_message_id: string | null; // Message ID from platform
  metadata: any | null;         // JSON for platform-specific data
  created_at: string;           // Query timestamp
}

interface BotResponse {
  id: string;                    // UUID primary key
  user_query_id: string;        // References user_queries.id
  conversation_id: string;       // References conversations.id
  content: string;              // Bot's response content
  platform_message_id: string | null; // Response message ID from platform
  tokens_used: number | null;   // AI model tokens consumed
  model_used: string | null;    // AI model name (e.g., 'gemini-2.5-flash')
  processing_time_ms: number | null; // Response generation time
  metadata: any | null;         // JSON for additional data
  created_at: string;           // Response timestamp
}
```

#### Core Database Functions

**User Management Functions:**

```typescript
// Creates or updates a user record
async function upsertUser(platformType: string, platformUserId: string, additionalData?: Partial<User>): Promise<{success: boolean, user?: User, error?: string}>
```
- **Purpose**: Ensures user exists in database, creates if missing
- **Parameters**: 
  - `platformType`: Platform identifier ('slack', 'discord', etc.)
  - `platformUserId`: User ID from the platform
  - `additionalData`: Optional user profile data
- **Returns**: Success status with user object or error message
- **Usage**: Called on every user interaction to maintain user records

```typescript
// Retrieves user by platform and ID
async function getUser(platformType: string, platformUserId: string): Promise<{success: boolean, user?: User, error?: string}>
```
- **Purpose**: Fetch existing user record
- **Logic**: Queries users table with platform_type and platform_user_id
- **Returns**: User object if found, null if not exists

**Conversation Management Functions:**

```typescript
// Gets existing conversation or creates new one
async function getOrCreateConversation(platformType: string, userId: string, platformConversationId: string, threadId?: string): Promise<{success: boolean, conversation?: Conversation, error?: string}>
```
- **Purpose**: Central function for conversation lifecycle management
- **Logic**: 
  1. Searches for existing conversation by platform_conversation_id
  2. If thread_id provided, appends to platform_conversation_id
  3. Creates new conversation if none exists
  4. Updates last activity timestamp
- **Threading Support**: Handles Slack threads by combining channel + thread IDs
- **Returns**: Conversation object with auto-generated title if new

```typescript
// Archives conversation (soft delete)
async function archiveConversation(conversationId: string): Promise<boolean>
```
- **Purpose**: Marks conversation as deleted without removing data
- **Logic**: Sets is_archived = true, preserves all message history
- **Usage**: Triggered by /delete slash command

**Message Storage Functions:**

```typescript
// Saves user's message to database
async function saveUserQuery(conversationId: string, userId: string, content: string, platformMessageId?: string, metadata?: any): Promise<{success: boolean, query?: UserQuery, error?: string}>
```
- **Purpose**: Persists user messages for conversation context
- **Parameters**:
  - `content`: The actual message text
  - `platformMessageId`: Slack timestamp or platform message ID
  - `metadata`: Platform-specific data (channel info, thread info, etc.)
- **Returns**: UserQuery object with generated UUID

```typescript
// Saves bot's response to database
async function saveBotResponse(userQueryId: string, conversationId: string, content: string, metadata?: any): Promise<{success: boolean, response?: BotResponse, error?: string}>
```
- **Purpose**: Stores AI-generated responses with performance metrics
- **Metadata Structure**:
  ```typescript
  {
    platformMessageId?: string,    // Slack message timestamp
    tokensUsed?: number,          // AI tokens consumed
    modelUsed?: string,           // AI model name
    processingTimeMs?: number,    // Generation time
    platformMetadata?: any        // Channel, thread info
  }
  ```
- **Links**: Creates relationship between user query and bot response

**Conversation History Functions:**

```typescript
// Retrieves conversation messages for AI context
async function getConversationHistory(conversationId: string, limit?: number): Promise<{success: boolean, messages?: ConversationMessage[], error?: string}>
```
- **Purpose**: Provides chat history for AI context and continuity
- **Logic**:
  1. Joins user_queries and bot_responses tables
  2. Orders by creation timestamp
  3. Formats as alternating user/assistant messages
  4. Limits results for performance (default 50)
- **Return Format**:
  ```typescript
  {
    role: 'user' | 'assistant',
    content: string,
    timestamp: string,
    platform_message_id?: string
  }
  ```
- **AI Integration**: Used by Gemini for maintaining conversation context

**Advanced Query Functions:**

```typescript
// Finds bot response by platform message ID
async function findBotResponseByPlatformMessageId(platformMessageId: string): Promise<{success: boolean, response?: BotResponse, error?: string}>
```
- **Purpose**: Enables reaction tracking and message updates
- **Usage**: When users react to bot messages, find the corresponding database record
- **Indexing**: Requires index on platform_message_id for performance

**Reaction System Functions:**

```typescript
// Adds emoji reaction to message
async function addMessageReaction(responseId: string, userId: string, reactionName: string, platformType: string): Promise<{success: boolean, reaction?: MessageReaction, error?: string}>

// Removes emoji reaction from message
async function removeMessageReaction(responseId: string, userId: string, reactionName: string): Promise<{success: boolean, error?: string}>
```
- **Purpose**: Tracks user sentiment and engagement through emoji reactions
- **Reaction Types**: Positive (+1, heart, fire), Negative (-1, thumbsdown), Neutral (eyes, thinking)
- **Analytics**: Enables sentiment analysis and user satisfaction metrics

#### Database Schema Relationships

```
users (1) ←→ (many) conversations ←→ (many) user_queries ←→ (1) bot_responses
                                   ↓
                              message_reactions
```

#### Error Handling Patterns

All database functions follow consistent error handling:
1. **Input Validation**: Check required parameters
2. **Database Errors**: Catch and log SQL errors
3. **Return Format**: Standardized `{success: boolean, data?: T, error?: string}`
4. **Logging**: Comprehensive console logging for debugging

#### Performance Considerations

- **Indexes**: Created on platform lookups and message timestamps
- **Limits**: Conversation history limited to prevent memory issues
- **Archiving**: Soft deletes preserve data while improving query performance
- **Metadata**: JSON fields for flexible platform-specific data storage

---

## `supabase/functions/_shared/gemini.ts`

**Purpose**: AI response generation using Google Gemini 2.5-flash with advanced language detection and conversation context management.

**Dependencies**:
- `@google/generative-ai` - Google Gemini SDK
- `centralized-database.ts` - For conversation history
- Environment variables: `GEMINI_API_KEY`

### Core AI Functions

#### Language Detection System

```typescript
async function detectLanguage(text: string): Promise<{language: string, confidence: number}>
```

**Purpose**: Intelligently detects the language of user input to ensure proper response language matching.

**Detection Logic**:
1. **English Pattern Matching**: Looks for strong English indicators
   - Common English words: "the", "and", "is", "are", "you", "I", "what", "how", "can"
   - English-specific patterns: contractions ("don't", "can't"), question words
   - Confidence boost for multiple English indicators

2. **German Pattern Detection**: Identifies German language features
   - German articles: "der", "die", "das", "ein", "eine"
   - German-specific words: "und", "ist", "sind", "wie", "was"
   - Umlauts and German characters: "ä", "ö", "ü", "ß"

3. **Confidence Scoring**:
   - High confidence (0.8+): Multiple strong language indicators
   - Medium confidence (0.5-0.7): Some indicators present
   - Low confidence (<0.5): Unclear or mixed language

**Return Values**:
- `{language: 'english', confidence: 0.9}` - Strong English detection
- `{language: 'german', confidence: 0.8}` - Strong German detection
- `{language: 'unknown', confidence: 0.3}` - Cannot determine language

#### Main AI Response Generation

```typescript
async function generateGeminiResponse(
  prompt: string, 
  conversationId: string, 
  userId: string, 
  model: string = 'gemini-2.5-flash',
  currentMessage?: string
): Promise<{success: boolean, response: string, tokensUsed?: number, processingTime: number, error?: string}>
```

**Purpose**: Generates contextually aware AI responses with proper language matching and conversation continuity.

**Process Flow**:

1. **Language Detection**: 
   ```typescript
   const detection = await detectLanguage(currentMessage || prompt);
   ```
   - Uses the current message (not conversation history) for accurate language detection
   - Prevents language confusion from mixed-language conversation history

2. **Conversation Context Retrieval**:
   ```typescript
   const historyResult = await CentralizedDB.getConversationHistory(conversationId);
   const conversationHistory = historyResult.success ? historyResult.messages : [];
   ```
   - Fetches up to 50 previous messages for context
   - Builds conversation context while preserving memory limits

3. **Context Building**:
   ```typescript
   const historyContext = buildConversationContext(conversationHistory, prompt);
   const fullPrompt = `${historyContext}\n\nUser: ${prompt}`;
   ```
   - Formats conversation history as User/Assistant alternating messages
   - Maintains chronological order for coherent context

4. **System Prompt Construction**:
   ```typescript
   // For English responses
   const systemPrompt = `You are a helpful AI assistant in a Slack workspace. 
   CRITICAL: You MUST respond in ENGLISH ONLY. The user wrote their message in English, so you must reply in English.
   Keep responses concise, helpful, and professional. Always use English language for your response.`;
   
   // For other languages
   const systemPrompt = `You are a helpful AI assistant in a Slack workspace. 
   IMPORTANT: The user's current message is in ${detection.language}. You MUST respond in the same language as the user's CURRENT message, which is ${detection.language}. 
   Keep responses concise, helpful, and professional.`;
   ```
   - **Critical Fix**: Explicitly instructs Gemini to respond in the detected language
   - Prevents the AI from defaulting to German when conversation history contains German

5. **AI Model Invocation**:
   ```typescript
   const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
   const result = await model.generateContent(languageContextPrompt);
   const text = response.text();
   ```
   - Uses Google Gemini 2.5-flash for fast, high-quality responses
   - Includes full conversation context with language instructions

6. **Performance Metrics Tracking**:
   ```typescript
   const processingTime = Date.now() - startTime;
   const tokensUsed = response.usageMetadata?.totalTokenCount;
   ```
   - Measures response generation time for performance monitoring
   - Tracks token usage for cost analysis and optimization

#### Conversation Title Generation

```typescript
async function generateConversationTitle(firstMessage: string): Promise<string>
```

**Purpose**: Creates descriptive titles for conversations based on the initial user message.

**Logic**:
- Takes the first message of a conversation
- Uses Gemini to generate a concise, descriptive title (max 8 words)
- Fallback to message substring if AI fails
- Example: "Can you help me with Python?" → "Python Programming Help"

#### Emoji Reaction Response System

```typescript
async function generateReactionResponse(
  reactionName: string,
  originalMessage?: string
): Promise<{success: boolean, response: string, error?: string}>
```

**Purpose**: Generates contextual responses to emoji reactions for user engagement.

**Sentiment Analysis**:

1. **Positive Reactions**: `['+1', 'thumbsup', 'heart', 'heart_eyes', 'fire', 'star', 'clap', 'raised_hands', '100', 'white_check_mark', 'ok_hand', 'muscle', 'sparkles', 'tada']`
   - Responses: "Glad you found that helpful! 😊", "Thanks for the positive feedback! 👍"

2. **Negative Reactions**: `['-1', 'thumbsdown', 'x', 'angry', 'rage', 'disappointed', 'confused', 'thinking_face', 'face_with_raised_eyebrow']`
   - Responses: "Sorry that didn't match your expectations. Let me try to help you differently."

3. **Neutral Reactions**: `['eyes', 'thinking', 'shrug']`
   - Responses: "I see you're thinking about this. Let me know if you need clarification!"

**Response Generation**:
- Randomly selects from appropriate response pool
- Maintains conversational tone
- Encourages further interaction when needed

### AI Integration Architecture

**Environment Setup**:
```typescript
let genAI: GoogleGenerativeAI | null = null;

function initializeGemini(): void {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    console.error('GEMINI_API_KEY not found in environment variables');
    return;
  }
  genAI = new GoogleGenerativeAI(apiKey);
}
```

**Error Handling**:
- Graceful degradation when AI API is unavailable
- Comprehensive error logging for debugging
- Fallback responses for critical failures

**Performance Optimizations**:
- Connection reuse across requests
- Context length management
- Response time monitoring
- Token usage tracking for cost optimization

---

## `supabase/functions/_shared/slack.ts`

**Purpose**: Slack API integration layer that handles all communication with Slack's platform APIs including messaging, reactions, and user management.

**Dependencies**:
- Slack Bot Token (`SLACK_BOT_TOKEN`)
- Slack Signing Secret (`SLACK_SIGNING_SECRET`)

### Core Slack Integration Functions

#### User Information Management

```typescript
async function getSlackUserInfo(userId: string): Promise<any | null>
```

**Purpose**: Retrieves comprehensive user profile information from Slack API.

**API Call**: `https://slack.com/api/users.info?user=${userId}`

**Return Data Structure**:
```typescript
{
  display_name: string,    // User's display name or real name
  email: string,          // User's email address  
  timezone: string,       // User's timezone setting
  avatar_url: string      // Profile picture URL (192px)
}
```

**Error Handling**:
- Returns `null` if SLACK_BOT_TOKEN missing
- Returns `null` if Slack API returns error
- Logs comprehensive error information for debugging

**Usage**: Called during user upsert to populate user profile data

#### Message Management Functions

```typescript
async function sendSlackMessage(
  channel: string,
  text: string,
  threadTs?: string
): Promise<{ok: boolean, ts?: string, channel?: string}>
```

**Purpose**: Core function for sending messages to Slack channels or threads.

**API Endpoint**: `https://slack.com/api/chat.postMessage`

**Parameters**:
- `channel`: Slack channel ID (e.g., 'C1234567890')
- `text`: Message content (supports Slack markdown)
- `threadTs`: Optional thread timestamp for threaded replies

**Payload Structure**:
```typescript
{
  channel: string,
  text: string,
  thread_ts?: string    // Only included if threadTs provided
}
```

**Return Object**:
- `ok: true` + `ts` + `channel` - Success with message timestamp
- `ok: false` - Failed to send message

**Threading Support**: Automatically handles thread replies when `threadTs` provided

```typescript
async function updateSlackMessage(
  channel: string,
  ts: string,
  text: string
): Promise<boolean>
```

**Purpose**: Updates existing Slack messages (used for status message updates).

**API Endpoint**: `https://slack.com/api/chat.update`

**Use Case**: 
1. Send initial "⚡ Generating response..." message
2. AI generates response
3. Update same message with actual response (prevents message spam)

**Benefits**:
- Reduces chat noise
- Provides real-time status updates
- Maintains conversation flow

#### Typing Indicators and Status Messages

```typescript
async function sendTypingIndicator(
  channel: string,
  threadTs?: string
): Promise<{ok: boolean, ts?: string, channel?: string}>
```

**Purpose**: Sends engaging "thinking" messages to indicate bot activity.

**Random Messages Pool**:
```typescript
[
  "🤔 Let me think about that...",
  "💭 Processing your request...",
  "⚡ Generating response...",
  "🧠 Thinking...",
  "✨ Working on it..."
]
```

**Implementation**: Randomly selects message and calls `sendSlackMessage()`

**User Experience**: Provides immediate feedback that bot received the message

#### Advanced Slack Features

```typescript
async function clearScreenMessages(channel: string, userId: string): Promise<boolean>
```

**Purpose**: Removes bot messages from Slack conversation history (triggered by `/clear` command).

**Process Flow**:

1. **Fetch Conversation History**:
   ```typescript
   GET https://slack.com/api/conversations.history?channel=${channel}&limit=200
   ```

2. **Identify Bot Messages**:
   ```typescript
   GET https://slack.com/api/auth.test  // Get bot user ID
   ```
   - Filters messages where `message.user === botUserId`

3. **Delete Bot Messages**:
   ```typescript
   POST https://slack.com/api/chat.delete
   {
     channel: channel,
     ts: message.ts
   }
   ```

4. **Send Confirmation**:
   ```typescript
   await sendSlackMessage(channel, "🧹 **Screen Cleared!**\n\nThe messages have been cleared from your screen...");
   ```

**Limitations**:
- Can only delete bot's own messages (Slack API restriction)
- Cannot delete user messages
- Conversation context preserved in database

### Security and Validation

```typescript
function verifySlackRequest(
  body: string,
  timestamp: string,
  signature: string
): boolean
```

**Purpose**: Validates incoming Slack requests using HMAC signature verification.

**Security Checks**:
1. **Timestamp Validation**: Request must be within 5 minutes (prevents replay attacks)
2. **Signature Verification**: HMAC-SHA256 signature using SLACK_SIGNING_SECRET
3. **Base String**: `v0:${timestamp}:${body}`

**Implementation Note**: Currently simplified for Edge Functions (production should implement full crypto.subtle HMAC)

---

## `supabase/functions/_shared/cors.ts`

**Purpose**: Centralized CORS configuration for all Edge Functions.

**Configuration**:
```typescript
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
```

**Usage**: Imported by all Edge Functions to ensure consistent cross-origin request handling.

---

## `supabase/functions/slack-events-centralized/index.ts`

**Purpose**: Main Slack event handler that processes all incoming Slack events including messages, reactions, and URL verification. This is the primary entry point for Slack API webhooks.

**Dependencies**:
- `centralized-database.ts` - Database operations
- `gemini.ts` - AI response generation
- `slack.ts` - Slack API communication

### Event Handler Architecture

The function uses `Deno.serve()` to handle HTTP requests and processes different types of Slack events:

#### 1. URL Verification Challenge

```typescript
if (event.type === 'url_verification') {
  return new Response(JSON.stringify({ challenge: event.challenge }));
}
```

**Purpose**: Slack's security mechanism to verify webhook endpoint ownership during initial setup.

#### 2. Message Event Processing

**Background Processing Pattern**:
```typescript
setTimeout(async () => {
  // Process message in background
}, 100);

// Return immediate success to Slack
return new Response(JSON.stringify({ ok: true }));
```

**Critical Design**: Slack requires response within 3 seconds, so processing happens in background while immediately acknowledging receipt.

**Processing Pipeline**:

1. **User Management**: `CentralizedDB.upsertUser('slack', userId)`
2. **Conversation Management**: `CentralizedDB.getOrCreateConversation()`
3. **Message Storage**: `CentralizedDB.saveUserQuery()`
4. **Status Updates**: Send typing indicator and placeholder message
5. **AI Processing**: Generate response with conversation context
6. **Message Updates**: Update placeholder with actual response
7. **Response Storage**: Save bot response to database
8. **Title Generation**: Auto-generate conversation titles

#### 3. Emoji Reaction Processing

```typescript
if (event.type === 'event_callback' && (event.event?.type === 'reaction_added' || event.event?.type === 'reaction_removed')) {
```

**Process**:
1. Find bot response by message timestamp
2. Add/remove reaction in database
3. Track sentiment for analytics

### Key Features

- **Loop Prevention**: Ignores bot messages to prevent infinite loops
- **Threading Support**: Handles Slack thread conversations
- **Language Detection**: Uses current message for accurate language detection
- **Performance Monitoring**: Tracks processing time and token usage
- **Error Recovery**: Comprehensive error handling with detailed logging

---

## `supabase/functions/slack-commands/index.ts`

**Purpose**: Handles Slack slash commands for conversation management.

### Available Commands

#### `/clear` - Screen Cleanup
- Removes bot messages from Slack (preserves database)
- Maintains conversation context
- Shows clear limitations (can't delete user messages)

#### `/new-chat` - Fresh Conversation
- Creates new conversation ID
- Preserves old conversation data
- Provides clean context slate

#### `/delete` - Complete Removal
- Archives conversation in database
- Removes screen messages
- Provides detailed deletion report

#### `/help` - Documentation
- Shows all available commands
- Explains bot features
- Provides usage guidance

### Command Architecture

**Immediate Response Pattern**:
```typescript
// Return immediate acknowledgment
return new Response(JSON.stringify({
  response_type: "ephemeral",
  text: "🔄 Processing command..."
}));

// Process in background
setTimeout(async () => {
  // Do actual work
  await sendDelayedResponse(responseUrl, result);
}, 50);
```

**Benefits**:
- Meets Slack's 3-second timeout requirement
- Provides detailed feedback via delayed responses
- Handles long-running operations gracefully

---

## 🚀 Deployment Guide

### Prerequisites

1. **Supabase Project**: Set up Supabase project with PostgreSQL database
2. **Environment Variables**:
   ```bash
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_anon_key
   GEMINI_API_KEY=your_gemini_api_key
   SLACK_BOT_TOKEN=xoxb-your-bot-token
   SLACK_SIGNING_SECRET=your_signing_secret
   ```

### Database Setup

Run the schema migration:
```sql
-- Execute centralized_db.sql or new-schema.sql
-- Creates users, conversations, user_queries, bot_responses, message_reactions tables
```

### Function Deployment

```bash
# Deploy Edge Functions
supabase functions deploy slack-events-centralized
supabase functions deploy slack-commands

# Set environment variables
supabase secrets set GEMINI_API_KEY=your_key
supabase secrets set SLACK_BOT_TOKEN=your_token
supabase secrets set SLACK_SIGNING_SECRET=your_secret
```

### Slack App Configuration

1. **Event Subscriptions**: Point to your Edge Function URL
2. **Slash Commands**: Configure each command endpoint
3. **Bot Token Scopes**: Grant necessary permissions
4. **Install App**: Add to your Slack workspace

---

## 🔧 Troubleshooting

### Common Issues

1. **Language Detection Problems**: Ensure current message is passed separately from conversation history
2. **Message Timeouts**: Verify background processing pattern is implemented
3. **Database Errors**: Check connection strings and table schemas
4. **API Rate Limits**: Implement proper error handling and retry logic

### Debugging Tools

- **Console Logging**: Comprehensive logging throughout all functions
- **Error Tracking**: Standardized error response format
- **Performance Metrics**: Processing time and token usage monitoring

This documentation provides a complete understanding of your Slack-Gemini bot's architecture, implementation details, and operational guidelines. Each file and function is explained with its purpose, dependencies, and integration patterns.


---

## 🗄️ **CENTRALIZED DATABASE MODULE**
### **File: `_shared/centralized-database.ts`** (1004 lines)

#### **📋 Type Definitions (Lines 1-150)**

**Line 7:** 
```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
```
- **Purpose:** Imports Supabase client for database operations
- **Why:** Enables interaction with Supabase database from Edge Functions

**Lines 10-12:**
```typescript
type PlatformType = 'slack' | 'discord' | 'whatsapp' | 'telegram' | 'twitch';
type ConversationStatus = 'active' | 'archived' | 'deleted';
type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';
```
- **Purpose:** Defines core type unions for the system
- **PlatformType:** Supports multiple chat platforms (currently using 'slack')
- **ConversationStatus:** Tracks conversation lifecycle
- **MessageStatus:** Tracks message delivery status

**Lines 14-31:**
```typescript
interface User {
  id: string;                    // UUID primary key
  platform: PlatformType;       // Which platform (slack/discord/etc)
  platform_user_id: string;     // User ID from the platform (e.g., Slack user ID)
  username?: string;             // Platform username
  display_name?: string;         // Human-readable name
  email?: string;               // Email address
  phone_number?: string;        // Phone number
  avatar_url?: string;          // Profile picture URL
  language_code: string;        // Preferred language (e.g., 'en', 'de')
  timezone?: string;            // User's timezone
  is_bot: boolean;              // Whether this is a bot account
  is_active: boolean;           // Whether account is active
  notifications_enabled: boolean; // Whether user wants notifications
  first_seen_at: string;        // When user first interacted
  last_seen_at: string;         // Last interaction timestamp
  created_at: string;           // Record creation time
  updated_at: string;           // Last update time
  platform_metadata: any;      // Platform-specific data (JSON)
}
```
- **Purpose:** Defines user data structure
- **Key Fields:**
  - `platform_user_id`: Maps to Slack user ID (e.g., "U09JX8EU8E7")
  - `platform_metadata`: Stores Slack-specific data like team_id, is_admin, etc.
  - `language_code`: Used for AI response language detection

**Lines 35-55:**
```typescript
interface Conversation {
  id: string;                   // UUID primary key
  platform: PlatformType;      // Platform (slack)
  user_id: string;             // References User.id
  channel_id?: string;         // Slack channel ID (e.g., "D09K2TWB762")
  channel_name?: string;       // Human-readable channel name
  thread_id?: string;          // Slack thread timestamp for threaded conversations
  is_group_chat: boolean;      // Whether it's a group/channel vs DM
  is_dm: boolean;              // Whether it's a direct message
  status: ConversationStatus;  // active/archived/deleted
  title?: string;              // AI-generated conversation title
  last_activity_at: string;    // Last message timestamp
  message_count: number;       // Total messages in conversation
  created_at: string;          // When conversation started
  updated_at: string;          // Last update
  archived_at?: string;        // When archived (if applicable)
  platform_metadata: any;     // Slack-specific data
}
```
- **Purpose:** Represents a conversation between user and bot
- **Key Relationships:** 
  - One User can have multiple Conversations
  - Each conversation tied to specific Slack channel/DM

**Lines 58-70:**
```typescript
interface UserQuery {
  id: string;                   // UUID primary key
  conversation_id: string;      // References Conversation.id
  user_id: string;             // References User.id
  content: string;             // The actual message text
  platform_message_id?: string; // Slack message timestamp (e.g., "1697534567.123456")
  has_attachments: boolean;     // Whether message has files/images
  attachment_urls?: string[];   // URLs of attached files
  message_type: string;         // 'text', 'image', 'file', etc.
  status: MessageStatus;        // sent/delivered/read/failed
  created_at: string;          // When message was sent
  platform_metadata: any;     // Slack-specific data (channel, thread info)
}
```
- **Purpose:** Stores user messages/queries
- **Key Field:** `platform_message_id` is Slack's message timestamp for tracking

**Lines 72-95:**
```typescript
interface BotResponse {
  id: string;                   // UUID primary key
  query_id: string;            // References UserQuery.id (which query this responds to)
  conversation_id: string;     // References Conversation.id
  content: string;             // AI-generated response text
  platform_message_id?: string; // Slack timestamp of bot's message
  model_used: string;          // AI model (e.g., "gemini-2.5-flash")
  tokens_used?: number;        // Number of tokens consumed
  prompt_tokens?: number;      // Tokens in the prompt
  completion_tokens?: number;  // Tokens in the response
  processing_time_ms?: number; // How long AI took to respond
  has_attachments: boolean;    // Whether response has files
  attachment_urls?: string[];  // URLs of response attachments
  response_type: string;       // 'text', 'markdown', etc.
  error_message?: string;      // If generation failed
  error_code?: string;         // Error classification
  retry_count: number;         // Number of retry attempts
  status: MessageStatus;       // sent/delivered/read/failed
  created_at: string;          // When response was generated
  platform_metadata: any;     // Slack-specific data
}
```
**Lines 72-95:**
```typescript
interface BotResponse {
  id: string;                   // UUID primary key
  query_id: string;            // References UserQuery.id (which query this responds to)
  conversation_id: string;     // References Conversation.id
  content: string;             // AI-generated response text
  platform_message_id?: string; // Slack timestamp of bot's message
  model_used: string;          // AI model (e.g., "gemini-2.5-flash")
  tokens_used?: number;        // Number of tokens consumed
  prompt_tokens?: number;      // Tokens in the prompt
  completion_tokens?: number;  // Tokens in the response
  processing_time_ms?: number; // How long AI took to respond
  has_attachments: boolean;    // Whether response has files
  attachment_urls?: string[];  // URLs of response attachments
  response_type: string;       // 'text', 'markdown', etc.
  error_message?: string;      // If generation failed
  error_code?: string;         // Error classification
  retry_count: number;         // Number of retry attempts
  status: MessageStatus;       // sent/delivered/read/failed
  created_at: string;          // When response was generated
  platform_metadata: any;     // Slack-specific data
}
```
- **Purpose:** Stores AI-generated responses
- **Key Relationships:** Each BotResponse links to a specific UserQuery
- **Performance Tracking:** Stores tokens, processing time for analytics

---

#### **🔧 Core Database Functions**

#### **1. upsertUser() - Lines 193-255**
```typescript
export async function upsertUser(
  platform: PlatformType,           // 'slack'
  platformUserId: string,           // Slack user ID (e.g., "U09JX8EU8E7")
  userData?: Partial<UserInsert>    // Optional user data
): Promise<{ success: boolean; user?: User; error?: string }>
```

**Purpose:** Creates new user or updates existing user
**Flow:**
1. **Line 199:** Logs user creation attempt
2. **Lines 201-213:** Builds user record with defaults:
   - `platform`: 'slack'
   - `platform_user_id`: Slack user ID
   - `display_name`: Defaults to platform ID if not provided
   - `language_code`: Defaults to 'en'
   - `is_active`: Defaults to true
   - `notifications_enabled`: Defaults to true
3. **Lines 215-220:** Database upsert operation:
   - Uses `onConflict: 'platform,platform_user_id'` to handle duplicates
   - Updates `last_seen_at` on each interaction
4. **Lines 221-255:** Error handling and return result

**When Called:** Every time a Slack user sends a message or uses a command

**Example Usage:**
```typescript
const userResult = await CentralizedDB.upsertUser('slack', 'U09JX8EU8E7');
```

---

#### **2. getOrCreateConversation() - Lines 311-402**
```typescript
export async function getOrCreateConversation(
  platform: PlatformType,          // 'slack'
  userId: string,                   // User.id from database
  channelId?: string,               // Slack channel ID
  threadId?: string,                // Slack thread timestamp
  conversationData?: Partial<ConversationInsert>
): Promise<{ success: boolean; conversation?: Conversation; error?: string }>
```

**Purpose:** Finds existing conversation or creates new one
**Complex Logic Flow:**

**Lines 318-330: Strategy 1 - Thread Matching**
```typescript
if (threadId) {
  const { data: threadConversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('platform', platform)      // Must be same platform
    .eq('user_id', userId)          // Must be same user
    .eq('channel_id', channelId)    // Must be same channel
    .eq('thread_id', threadId)      // Must be same thread
    .single();
}
```
- **Purpose:** For threaded Slack conversations, find exact thread match
- **When Used:** When user replies in a Slack thread

**Lines 332-346: Strategy 2 - Recent Conversation**
```typescript
if (!threadId) {
  const { data: recentConversations } = await supabase
    .from('conversations')
    .select('*')
    .eq('platform', platform)
    .eq('user_id', userId)
    .eq('channel_id', channelId)
    .is('thread_id', null)          // Only non-threaded conversations
    .eq('status', 'active')         // Only active conversations
    .order('last_activity_at', { ascending: false })
    .limit(1);
}
```
- **Purpose:** For regular DMs, continue existing conversation
- **Logic:** Finds most recent active conversation in same channel

**Lines 348-402: Strategy 3 - Create New Conversation**
```typescript
const newConversation: ConversationInsert = {
  platform,
  user_id: userId,
  channel_id: channelId || '',
  thread_id: threadId || null,
  is_group_chat: conversationData?.is_group_chat || false,
  is_dm: conversationData?.is_dm ?? true,
  status: 'active',
  title: conversationData?.title || null,
  last_activity_at: new Date().toISOString(),
  message_count: 0,
  platform_metadata: conversationData?.platform_metadata || {}
};
```
- **Purpose:** Creates brand new conversation when none exists
- **Defaults:** Sets reasonable defaults for Slack DMs

**When Called:** Every time user sends a message

---

#### **3. saveUserQuery() - Lines 458-520**
```typescript
export async function saveUserQuery(
  conversationId: string,           // Conversation.id
  userId: string,                   // User.id
  content: string,                  // Message text
  platformMessageId?: string,       // Slack message timestamp
  metadata?: {
    hasAttachments?: boolean;
    attachmentUrls?: string[];
    messageType?: string;
    platformMetadata?: any;
  }
): Promise<{ success: boolean; query?: UserQuery; error?: string }>
```

**Purpose:** Saves user's message to database
**Flow:**
1. **Lines 467-477:** Builds query record:
   - `content`: The actual message text
   - `platform_message_id`: Slack's message timestamp (for tracking)
   - `has_attachments`: Whether message has files
   - `status`: Defaults to 'sent'
2. **Lines 479-483:** Inserts into `user_queries` table
3. **Lines 485-495:** Updates conversation metrics:
   - Increments `message_count`
   - Updates `last_activity_at`

**When Called:** Every time user sends a message, before AI processes it

---

#### **4. saveBotResponse() - Lines 522-586**
```typescript
export async function saveBotResponse(
  queryId: string,                  // UserQuery.id this responds to
  conversationId: string,           // Conversation.id
  content: string,                  // AI-generated response
  metadata?: {
    platformMessageId?: string;     // Slack timestamp of bot's message
    modelUsed?: string;             // 'gemini-2.5-flash'
    tokensUsed?: number;            // Token consumption
    processingTimeMs?: number;      // AI response time
    platformMetadata?: any;         // Slack-specific data
  }
): Promise<{ success: boolean; response?: BotResponse; error?: string }>
```

**Purpose:** Saves AI-generated response to database
**Flow:**
1. **Lines 532-548:** Builds response record with performance metrics
2. **Lines 550-554:** Inserts into `bot_responses` table
3. **Lines 556-566:** Updates conversation:
   - Increments `message_count`
   - Updates `last_activity_at`

**When Called:** After AI generates response, before sending to Slack

---

#### **5. getConversationHistory() - Lines 741-813**
```typescript
export async function getConversationHistory(
  conversationId: string,
  limit: number = 20,               // Max messages to retrieve
  offset: number = 0                // Pagination offset
): Promise<{ success: boolean; messages?: ConversationMessage[]; error?: string }>
```

**Purpose:** Retrieves conversation history for AI context
**Complex Query Logic:**

**Lines 748-765:** Fetches user queries with related bot responses:
```sql
SELECT * FROM user_queries 
JOIN bot_responses ON user_queries.id = bot_responses.query_id
WHERE conversation_id = ? 
ORDER BY created_at DESC 
LIMIT ? OFFSET ?
```

**Lines 767-790:** Transforms data into chronological conversation:
```typescript
queries?.reverse().forEach((query: any) => {
  // Add user query
  messages.push({
    role: 'user',
    content: query.content,
    created_at: query.created_at
  });

  // Add bot responses for this query
  query.bot_responses?.forEach((response: any) => {
    messages.push({
      role: 'assistant',
      content: response.content,
      created_at: response.created_at
    });
  });
});
```

**When Called:** Before generating AI response, to provide conversation context

---

#### **6. addMessageReaction() - Lines 665-707**
```typescript
export async function addMessageReaction(
  responseId: string,               // BotResponse.id
  userId: string,                   // User.id who added reaction
  reactionName: string,             // Emoji name (e.g., "thumbs_up")
  platform: PlatformType,          // 'slack'
  reactionUnicode?: string          // Unicode emoji
): Promise<{ success: boolean; reaction?: MessageReaction; error?: string }>
```

**Purpose:** Tracks emoji reactions on bot messages
**Flow:**
1. **Lines 673-679:** Builds reaction record
2. **Lines 681-685:** Inserts into `message_reactions` table
3. **Lines 687-692:** Handles duplicate reactions gracefully (error code 23505)

**When Called:** When user adds emoji reaction to bot's message