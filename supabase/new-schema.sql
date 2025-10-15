-- New Database Schema: Separate Tables for Queries and Responses

-- Table 1: User Queries
CREATE TABLE IF NOT EXISTS user_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  slack_message_ts TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Indexes for performance
  CONSTRAINT unique_slack_message UNIQUE (slack_message_ts)
);

CREATE INDEX idx_user_queries_conversation ON user_queries(conversation_id);
CREATE INDEX idx_user_queries_created_at ON user_queries(created_at DESC);

-- Table 2: Bot Responses
CREATE TABLE IF NOT EXISTS bot_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id UUID NOT NULL REFERENCES user_queries(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  slack_message_ts TEXT,
  
  -- AI metadata
  tokens_used INTEGER,
  model_used TEXT DEFAULT 'gemini-2.0-flash',
  processing_time_ms INTEGER,
  error_message TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Indexes for performance
  CONSTRAINT unique_slack_response_message UNIQUE (slack_message_ts)
);

CREATE INDEX idx_bot_responses_query ON bot_responses(query_id);
CREATE INDEX idx_bot_responses_created_at ON bot_responses(created_at DESC);

-- Table 3: Message Reactions (Updated to work with new structure)
DROP TABLE IF EXISTS message_reactions CASCADE;

CREATE TABLE message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES bot_responses(id) ON DELETE CASCADE,
  slack_user_id TEXT NOT NULL,
  reaction_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Prevent duplicate reactions
  CONSTRAINT unique_user_response_reaction UNIQUE (response_id, slack_user_id, reaction_name)
);

CREATE INDEX idx_message_reactions_response ON message_reactions(response_id);
CREATE INDEX idx_message_reactions_user ON message_reactions(slack_user_id);

-- Migration: Copy existing data from old 'messages' table to new tables
-- (Only run this if you want to preserve existing data)

-- Step 1: Copy user queries
INSERT INTO user_queries (id, conversation_id, content, slack_message_ts, created_at)
SELECT 
  id,
  conversation_id,
  content,
  slack_message_ts,
  created_at
FROM messages
WHERE message_type = 'user_query'
ON CONFLICT (slack_message_ts) DO NOTHING;

-- Step 2: Copy bot responses
-- Note: We need to link responses to queries by conversation and timestamp
WITH query_response_pairs AS (
  SELECT 
    q.id as query_id,
    r.id as response_id,
    r.conversation_id,
    r.content,
    r.slack_message_ts,
    r.tokens_used,
    r.model_used,
    r.processing_time_ms,
    r.error_message,
    r.created_at,
    ROW_NUMBER() OVER (PARTITION BY r.conversation_id ORDER BY r.created_at) as response_num,
    ROW_NUMBER() OVER (PARTITION BY q.conversation_id ORDER BY q.created_at) as query_num
  FROM messages r
  CROSS JOIN messages q
  WHERE r.message_type = 'bot_response'
    AND q.message_type = 'user_query'
    AND r.conversation_id = q.conversation_id
    AND r.created_at > q.created_at
)
INSERT INTO bot_responses (id, query_id, content, slack_message_ts, tokens_used, model_used, processing_time_ms, error_message, created_at)
SELECT DISTINCT ON (response_id)
  response_id as id,
  query_id,
  content,
  slack_message_ts,
  tokens_used,
  model_used,
  processing_time_ms,
  error_message,
  created_at
FROM query_response_pairs
WHERE response_num = query_num
ON CONFLICT (slack_message_ts) DO NOTHING;

-- Optional: Drop old messages table after verification
-- IMPORTANT: This will permanently delete the old messages table
-- Only uncomment and run this AFTER verifying the migration worked correctly
DROP TABLE IF EXISTS messages CASCADE;

-- Add helpful comments
COMMENT ON TABLE user_queries IS 'Stores all user questions/queries sent to the bot';
COMMENT ON TABLE bot_responses IS 'Stores all bot responses, linked to their corresponding user queries';
COMMENT ON TABLE message_reactions IS 'Stores user reactions (👍👎❤️) on bot responses for feedback tracking';

-- Grant permissions (adjust based on your Supabase setup)
ALTER TABLE user_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Enable read access for all users" ON user_queries FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON user_queries FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable read access for all users" ON bot_responses FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON bot_responses FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable read access for all users" ON message_reactions FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON message_reactions FOR INSERT WITH CHECK (true);
