# Emoji Reaction Feature Implementation

## Overview
This feature allows the Slack bot to:
1. **Store emoji reactions** in the `message_reactions` table when users react to bot messages
2. **Generate sentiment-based responses** using Gemini AI based on the emoji reaction type

## Components Updated

### 1. Database Functions (`supabase/functions/_shared/database.ts`)
- **`addMessageReaction()`** - Stores emoji reactions in the database
- **`removeMessageReaction()`** - Removes emoji reactions from the database
- **`findBotResponseByTimestamp()`** - Finds bot responses by Slack message timestamp
- **`updateBotResponseTimestamp()`** - Updates bot responses with Slack message timestamps

### 2. Gemini AI Functions (`supabase/functions/_shared/gemini.ts`)
- **`generateReactionResponse()`** - Generates sentiment-based responses to emoji reactions
- **`analyzeReactionSentiment()`** - (Already existed) Analyzes reaction sentiment

### 3. Slack Events Handler (`supabase/functions/slack-events/index.ts`)
- **`handleReactionAdded()`** - Processes when users add emoji reactions
- **`handleReactionRemoved()`** - Processes when users remove emoji reactions
- Updated message handlers to store Slack message timestamps

## How It Works

### Reaction Processing Flow
1. **User adds emoji reaction** to a bot message
2. **Slack sends reaction_added event** to the edge function
3. **Bot finds the original message** using timestamp and channel
4. **Stores reaction in database** (`message_reactions` table)
5. **Analyzes reaction sentiment** (positive/negative/neutral)
6. **Generates appropriate response** based on sentiment
7. **Sends response as thread reply**

### Sentiment Categories

#### Positive Reactions
- Emojis: `+1`, `thumbsup`, `heart`, `heart_eyes`, `fire`, `star`, `clap`, `raised_hands`, `100`, `white_check_mark`, `ok_hand`, `muscle`, `sparkles`, `tada`
- Response Examples:
  - "Glad you found that helpful! 😊"
  - "Thanks for the positive feedback! 👍"
  - "Happy to help! Let me know if you need anything else."

#### Negative Reactions
- Emojis: `-1`, `thumbsdown`, `x`, `angry`, `rage`, `disappointed`, `confused`, `thinking_face`, `face_with_raised_eyebrow`
- Response Examples:
  - "Sorry that didn't match your expectations. Let me try to help you differently."
  - "I apologize if my response wasn't helpful. Could you clarify what you're looking for?"
  - "Sorry about that! Can you tell me more about what you need?"

#### Neutral Reactions
- Emojis: `eyes`, `thinking`, `shrug`
- Response Examples:
  - "I see you're thinking about this. Let me know if you need clarification!"
  - "Looks like you might have questions. Feel free to ask!"
  - "I notice you reacted - is there something specific you'd like to know?"

## Database Schema

### message_reactions Table
```sql
CREATE TABLE message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES bot_responses(id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL,
  reaction_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_user_response_reaction UNIQUE (response_id, slack_user_id, reaction_name)
);
```

### bot_responses Table (Updated)
```sql
CREATE TABLE IF NOT EXISTS bot_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id UUID NOT NULL REFERENCES user_queries(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  slack_message_ts TEXT, -- Used for reaction mapping
  -- ... other fields
);
```

## Usage Examples

1. **User asks a question**
   - Bot responds with answer
   
2. **User reacts with 👍**
   - Bot detects positive reaction
   - Bot replies in thread: "Glad you found that helpful! 😊"
   
3. **User reacts with 👎**
   - Bot detects negative reaction
   - Bot replies in thread: "Sorry that didn't match your expectations. Let me try to help you differently."

4. **User reacts with 🤔**
   - Bot detects neutral/thinking reaction
   - Bot replies in thread: "I see you're thinking about this. Let me know if you need clarification!"

## Configuration

No additional configuration required. The feature works automatically with:
- Slack reaction events (`reaction_added`, `reaction_removed`)
- Existing database tables
- Gemini AI integration

## Benefits

1. **Better User Experience** - Users get acknowledgment of their feedback
2. **Continuous Improvement** - Bot learns from user reactions
3. **Enhanced Engagement** - More interactive conversation flow
4. **Data Collection** - Reactions stored for analytics and improvement

## Technical Notes

- Reactions are stored with unique constraints to prevent duplicates
- Message timestamps are used to link reactions to the correct bot responses
- Thread replies keep conversations organized
- Sentiment analysis uses predefined emoji categorization
- All database operations include proper error handling