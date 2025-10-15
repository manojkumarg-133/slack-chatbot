-- ============================================
-- CENTRALIZED MULTI-PLATFORM CHATBOT SCHEMA
-- Supports: Slack, Discord, WhatsApp, Telegram, Twitch
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- ENUM TYPES
-- ============================================

CREATE TYPE platform_type AS ENUM ('slack', 'discord', 'whatsapp', 'telegram', 'twitch');
CREATE TYPE conversation_status AS ENUM ('active', 'archived', 'deleted');
CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'read', 'failed');

-- ============================================
-- TABLE 1: USERS
-- ============================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Platform identification
  platform platform_type NOT NULL,
  platform_user_id TEXT NOT NULL, -- The user's ID on their platform
  
  -- User information (some fields may be null depending on platform)
  username TEXT, -- NULL for WhatsApp, optional for others
  display_name TEXT, -- Display name or full name
  email TEXT, -- May not be available on all platforms
  phone_number TEXT, -- Primarily for WhatsApp
  
  -- Profile data
  avatar_url TEXT,
  language_code TEXT DEFAULT 'en',
  timezone TEXT,
  
  -- User preferences
  is_bot BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  notifications_enabled BOOLEAN DEFAULT true,
  
  -- Metadata
  first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Platform-specific metadata (JSONB for flexibility)
  platform_metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Constraints
  CONSTRAINT unique_platform_user UNIQUE (platform, platform_user_id)
);

-- Indexes
CREATE INDEX idx_users_platform ON users(platform);
CREATE INDEX idx_users_platform_user_id ON users(platform_user_id);
CREATE INDEX idx_users_last_seen ON users(last_seen_at DESC);
CREATE INDEX idx_users_platform_metadata ON users USING gin(platform_metadata);

COMMENT ON TABLE users IS 'Centralized user table supporting all platforms';
COMMENT ON COLUMN users.platform_metadata IS 'Stores platform-specific data like Slack team_id, Discord guild_id, etc.';

-- ============================================
-- TABLE 2: CONVERSATIONS
-- ============================================

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Platform and context
  platform platform_type NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Conversation context
  channel_id TEXT, -- Slack channel, Discord channel, WhatsApp chat, Telegram chat, Twitch channel
  channel_name TEXT,
  thread_id TEXT, -- For threaded conversations (Slack threads, Discord threads)
  is_group_chat BOOLEAN DEFAULT false,
  is_dm BOOLEAN DEFAULT false,
  
  -- Conversation state
  status conversation_status DEFAULT 'active',
  title TEXT, -- Optional conversation title
  
  -- Session management
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  message_count INTEGER DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  archived_at TIMESTAMP WITH TIME ZONE,
  
  -- Platform-specific metadata
  platform_metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Constraints
  CONSTRAINT unique_platform_conversation UNIQUE (platform, user_id, channel_id, thread_id)
);

-- Indexes
CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_platform ON conversations(platform);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_last_activity ON conversations(last_activity_at DESC);
CREATE INDEX idx_conversations_channel ON conversations(channel_id);

COMMENT ON TABLE conversations IS 'Tracks conversation sessions across all platforms';

-- ============================================
-- TABLE 3: USER QUERIES
-- ============================================

CREATE TABLE IF NOT EXISTS user_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Relationships
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Message content
  content TEXT NOT NULL,
  
  -- Platform-specific identifiers
  platform_message_id TEXT, -- Slack ts, Discord message ID, WhatsApp message ID, etc.
  
  -- Message metadata
  has_attachments BOOLEAN DEFAULT false,
  attachment_urls TEXT[], -- Array of attachment URLs
  message_type TEXT DEFAULT 'text', -- text, image, video, audio, file, sticker
  
  -- Status
  status message_status DEFAULT 'sent',
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Platform-specific metadata
  platform_metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Constraints
  CONSTRAINT unique_platform_message UNIQUE (conversation_id, platform_message_id)
);

-- Indexes
CREATE INDEX idx_user_queries_conversation ON user_queries(conversation_id);
CREATE INDEX idx_user_queries_user ON user_queries(user_id);
CREATE INDEX idx_user_queries_created_at ON user_queries(created_at DESC);
CREATE INDEX idx_user_queries_platform_message ON user_queries(platform_message_id);

COMMENT ON TABLE user_queries IS 'Stores all user messages/queries across platforms';

-- ============================================
-- TABLE 4: BOT RESPONSES
-- ============================================

CREATE TABLE IF NOT EXISTS bot_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Relationships
  query_id UUID NOT NULL REFERENCES user_queries(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  
  -- Response content
  content TEXT NOT NULL,
  
  -- Platform-specific identifiers
  platform_message_id TEXT, -- Response message ID on the platform
  
  -- AI metadata
  model_used TEXT DEFAULT 'gemini-2.0-flash',
  tokens_used INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  processing_time_ms INTEGER,
  
  -- Response metadata
  has_attachments BOOLEAN DEFAULT false,
  attachment_urls TEXT[],
  response_type TEXT DEFAULT 'text', -- text, image, card, embed, etc.
  
  -- Error handling
  error_message TEXT,
  error_code TEXT,
  retry_count INTEGER DEFAULT 0,
  
  -- Status
  status message_status DEFAULT 'sent',
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Platform-specific metadata
  platform_metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Constraints
  CONSTRAINT unique_platform_response_message UNIQUE (conversation_id, platform_message_id)
);

-- Indexes
CREATE INDEX idx_bot_responses_query ON bot_responses(query_id);
CREATE INDEX idx_bot_responses_conversation ON bot_responses(conversation_id);
CREATE INDEX idx_bot_responses_created_at ON bot_responses(created_at DESC);
CREATE INDEX idx_bot_responses_status ON bot_responses(status);

COMMENT ON TABLE bot_responses IS 'Stores all bot responses linked to user queries';

-- ============================================
-- TABLE 5: MESSAGE REACTIONS
-- ============================================

CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Relationships
  response_id UUID NOT NULL REFERENCES bot_responses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Reaction details
  reaction_name TEXT NOT NULL, -- Emoji name or code
  reaction_unicode TEXT, -- Unicode representation
  
  -- Platform context
  platform platform_type NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  removed_at TIMESTAMP WITH TIME ZONE, -- NULL if still active
  
  -- Constraints
  CONSTRAINT unique_user_response_reaction UNIQUE (response_id, user_id, reaction_name)
);

-- Indexes
CREATE INDEX idx_message_reactions_response ON message_reactions(response_id);
CREATE INDEX idx_message_reactions_user ON message_reactions(user_id);
CREATE INDEX idx_message_reactions_platform ON message_reactions(platform);
CREATE INDEX idx_message_reactions_created_at ON message_reactions(created_at DESC);

COMMENT ON TABLE message_reactions IS 'Tracks user reactions/feedback on bot responses';

-- ============================================
-- TABLE 6: PLATFORM CONFIGURATIONS
-- ============================================

CREATE TABLE IF NOT EXISTS platform_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Platform identification
  platform platform_type NOT NULL UNIQUE,
  
  -- Configuration
  is_enabled BOOLEAN DEFAULT true,
  webhook_url TEXT,
  api_base_url TEXT,
  
  -- Rate limiting
  rate_limit_per_minute INTEGER DEFAULT 60,
  rate_limit_per_hour INTEGER DEFAULT 1000,
  
  -- Features
  supports_threads BOOLEAN DEFAULT false,
  supports_reactions BOOLEAN DEFAULT true,
  supports_attachments BOOLEAN DEFAULT true,
  supports_rich_media BOOLEAN DEFAULT false,
  
  -- Configuration data (for API keys, tokens, etc. - store securely!)
  config_data JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_platform_configs_platform ON platform_configs(platform);
CREATE INDEX idx_platform_configs_enabled ON platform_configs(is_enabled);

COMMENT ON TABLE platform_configs IS 'Stores platform-specific configurations and capabilities';
COMMENT ON COLUMN platform_configs.config_data IS 'Store non-sensitive config only. Use Supabase Vault for secrets!';

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_configs ENABLE ROW LEVEL SECURITY;

-- Policies for USERS table
CREATE POLICY "Users: Enable read access for authenticated users" 
  ON users FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "Users: Enable insert for authenticated users" 
  ON users FOR INSERT 
  TO authenticated 
  WITH CHECK (true);

CREATE POLICY "Users: Enable update for authenticated users" 
  ON users FOR UPDATE 
  TO authenticated 
  USING (true);

-- Policies for CONVERSATIONS table
CREATE POLICY "Conversations: Enable read access for authenticated users" 
  ON conversations FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "Conversations: Enable insert for authenticated users" 
  ON conversations FOR INSERT 
  TO authenticated 
  WITH CHECK (true);

CREATE POLICY "Conversations: Enable update for authenticated users" 
  ON conversations FOR UPDATE 
  TO authenticated 
  USING (true);

-- Policies for USER_QUERIES table
CREATE POLICY "User queries: Enable read access for authenticated users" 
  ON user_queries FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "User queries: Enable insert for authenticated users" 
  ON user_queries FOR INSERT 
  TO authenticated 
  WITH CHECK (true);

-- Policies for BOT_RESPONSES table
CREATE POLICY "Bot responses: Enable read access for authenticated users" 
  ON bot_responses FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "Bot responses: Enable insert for authenticated users" 
  ON bot_responses FOR INSERT 
  TO authenticated 
  WITH CHECK (true);

CREATE POLICY "Bot responses: Enable update for authenticated users" 
  ON bot_responses FOR UPDATE 
  TO authenticated 
  USING (true);

-- Policies for MESSAGE_REACTIONS table
CREATE POLICY "Reactions: Enable read access for authenticated users" 
  ON message_reactions FOR SELECT 
  TO authenticated 
  USING (true);

CREATE POLICY "Reactions: Enable insert for authenticated users" 
  ON message_reactions FOR INSERT 
  TO authenticated 
  WITH CHECK (true);

CREATE POLICY "Reactions: Enable delete for authenticated users" 
  ON message_reactions FOR DELETE 
  TO authenticated 
  USING (true);

-- Policies for PLATFORM_CONFIGS table
CREATE POLICY "Platform configs: Enable read access for authenticated users" 
  ON platform_configs FOR SELECT 
  TO authenticated 
  USING (true);

-- Only allow service role to modify configs
CREATE POLICY "Platform configs: Enable insert for service role" 
  ON platform_configs FOR INSERT 
  TO service_role 
  WITH CHECK (true);

CREATE POLICY "Platform configs: Enable update for service role" 
  ON platform_configs FOR UPDATE 
  TO service_role 
  USING (true);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at 
  BEFORE UPDATE ON users 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at 
  BEFORE UPDATE ON conversations 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_platform_configs_updated_at 
  BEFORE UPDATE ON platform_configs 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update conversation message count and last activity
CREATE OR REPLACE FUNCTION increment_conversation_message_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations 
  SET 
    message_count = message_count + 1,
    last_activity_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to increment message count
CREATE TRIGGER increment_message_count_on_query 
  AFTER INSERT ON user_queries 
  FOR EACH ROW EXECUTE FUNCTION increment_conversation_message_count();

CREATE TRIGGER increment_message_count_on_response 
  AFTER INSERT ON bot_responses 
  FOR EACH ROW EXECUTE FUNCTION increment_conversation_message_count();

-- Function to update user's last_seen_at
CREATE OR REPLACE FUNCTION update_user_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE users 
  SET last_seen_at = NOW()
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update last_seen_at
CREATE TRIGGER update_user_last_seen_on_query 
  AFTER INSERT ON user_queries 
  FOR EACH ROW EXECUTE FUNCTION update_user_last_seen();

-- ============================================
-- INITIAL DATA: Platform Configurations
-- ============================================

INSERT INTO platform_configs (platform, supports_threads, supports_reactions, supports_attachments, supports_rich_media) VALUES
  ('slack', true, true, true, true),
  ('discord', true, true, true, true),
  ('whatsapp', false, false, true, true),
  ('telegram', false, true, true, true),
  ('twitch', false, false, false, false)
ON CONFLICT (platform) DO NOTHING;

-- ============================================
-- GRANTS (Adjust based on your setup)
-- ============================================

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

-- Grant access to tables
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;

-- Grant access to sequences
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ============================================
-- NOTES
-- ============================================

/*
SECURITY NOTES:
1. Never store API keys or tokens directly in platform_configs.config_data
2. Use Supabase Vault or environment variables for sensitive data
3. The RLS policies here are permissive - adjust based on your security needs
4. Consider adding policies that restrict users to only see their own data

USAGE TIPS:
1. Use the conversation_messages view to get full conversation history
2. Use platform_statistics view for dashboard metrics
3. Use response_metrics view to monitor bot performance
4. The platform_metadata JSONB fields are for platform-specific extras:
   - Slack: team_id, enterprise_id, is_enterprise_install
   - Discord: guild_id, guild_name
   - WhatsApp: business_account_id
   - Telegram: chat_type, is_premium
   - Twitch: broadcaster_id, mod_status
*/