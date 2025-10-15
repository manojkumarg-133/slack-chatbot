-- ============================================
-- FINAL MIGRATION SCRIPT: OLD SCHEMA → CENTRALIZED SCHEMA
-- ============================================
-- This script migrates data from the old single-platform schema
-- to the new centralized multi-platform schema
-- 
-- ✅ ALL CRITICAL FIXES APPLIED:
-- ✅ Proper UUID handling (no reuse)
-- ✅ Complete updated_at columns
-- ✅ Fixed foreign key constraints
-- ✅ Dynamic column detection for compatibility
-- ✅ Comprehensive validation
-- ✅ Production-ready error handling
--
-- IMPORTANT: Run this script in a transaction and test thoroughly
-- BACKUP YOUR DATABASE BEFORE RUNNING THIS SCRIPT
-- ============================================

BEGIN;

-- ============================================
-- STEP 0: DETECT CURRENT SCHEMA STRUCTURE
-- ============================================
DO $$
DECLARE
    has_slack_user_id BOOLEAN := FALSE;
    has_message_reactions BOOLEAN := FALSE;
    has_messages BOOLEAN := FALSE;
    has_conversations BOOLEAN := FALSE;
    message_reactions_columns TEXT;
BEGIN
    -- Check if old tables exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'messages'
    ) INTO has_messages;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'conversations'
    ) INTO has_conversations;
    
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'message_reactions'
    ) INTO has_message_reactions;
    
    -- Check if message_reactions has slack_user_id column
    IF has_message_reactions THEN
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'message_reactions' 
            AND column_name = 'slack_user_id'
        ) INTO has_slack_user_id;
        
        -- Get all columns in message_reactions for debugging
        SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) 
        INTO message_reactions_columns
        FROM information_schema.columns 
        WHERE table_name = 'message_reactions';
    END IF;
    
    -- Log what we found
    RAISE NOTICE '🔍 Current Schema Detection:';
    RAISE NOTICE '  ⚬ messages table exists: %', has_messages;
    RAISE NOTICE '  ⚬ conversations table exists: %', has_conversations;
    RAISE NOTICE '  ⚬ message_reactions table exists: %', has_message_reactions;
    RAISE NOTICE '  ⚬ slack_user_id column exists: %', has_slack_user_id;
    
    IF has_message_reactions THEN
        RAISE NOTICE '  ⚬ message_reactions columns: %', message_reactions_columns;
    END IF;
    
    -- Create temp table to store schema info for later steps
    CREATE TEMP TABLE temp_schema_info (
        has_slack_user_id BOOLEAN,
        has_message_reactions BOOLEAN,
        has_messages BOOLEAN,
        has_conversations BOOLEAN
    );
    
    INSERT INTO temp_schema_info VALUES (
        has_slack_user_id, 
        has_message_reactions, 
        has_messages, 
        has_conversations
    );
    
    -- Validation: Can we proceed with migration?
    IF NOT has_messages OR NOT has_conversations THEN
        RAISE EXCEPTION 'Missing required tables. Expected: messages, conversations. Found: messages=%, conversations=%', 
            has_messages, has_conversations;
    END IF;
    
    IF NOT has_message_reactions THEN
        RAISE WARNING 'message_reactions table not found. Will create users from other sources.';
    END IF;
    
    RAISE NOTICE '✅ Schema detection complete. Proceeding with migration...';
END
$$;

-- ============================================
-- STEP 1: CREATE TEMPORARY MIGRATION TABLES
-- ============================================

-- Create users from multiple sources based on available data
DO $$
DECLARE
    schema_info RECORD;
    user_source_query TEXT;
BEGIN
    SELECT * INTO schema_info FROM temp_schema_info;
    
    RAISE NOTICE '📊 Creating user migration table from available sources...';
    
    -- Build user source query based on available schema
    IF schema_info.has_message_reactions AND schema_info.has_slack_user_id THEN
        -- Use message_reactions table (preferred source)
        CREATE TEMP TABLE temp_migration_users AS
        SELECT DISTINCT 
            slack_user_id,
            MIN(created_at) as first_seen_at
        FROM message_reactions 
        WHERE slack_user_id IS NOT NULL
          AND TRIM(slack_user_id) != ''
        GROUP BY slack_user_id;
        
        RAISE NOTICE '  ✅ Using message_reactions.slack_user_id as user source';
    ELSE
        -- Fallback: Try to extract user info from other sources
        RAISE NOTICE '  ⚠️  slack_user_id not available, using fallback user creation';
        
        CREATE TEMP TABLE temp_migration_users AS
        SELECT DISTINCT 
            'unknown_user_' || ROW_NUMBER() OVER() as slack_user_id,
            NOW() as first_seen_at
        FROM conversations 
        LIMIT 1; -- Create at least one default user
    END IF;
END
$$;

-- Log user creation progress
DO $$
DECLARE
    user_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO user_count FROM temp_migration_users;
    RAISE NOTICE 'Found % unique users to migrate', user_count;
END
$$;

-- ============================================
-- STEP 2: MIGRATE USERS
-- ============================================

-- Create users table if it doesn't exist (for new centralized schema)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform platform_type NOT NULL DEFAULT 'slack',
    platform_user_id TEXT NOT NULL,
    username TEXT,
    display_name TEXT,
    email TEXT,
    phone_number TEXT,
    avatar_url TEXT,
    language_code TEXT DEFAULT 'en',
    timezone TEXT,
    is_bot BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    notifications_enabled BOOLEAN DEFAULT true,
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    platform_metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT unique_platform_user UNIQUE (platform, platform_user_id)
);

-- Create platform_type enum if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform_type') THEN
        CREATE TYPE platform_type AS ENUM ('slack', 'discord', 'whatsapp', 'telegram', 'twitch');
    END IF;
END
$$;

-- Insert users from discovered sources
INSERT INTO users (
    platform,
    platform_user_id,
    username,
    display_name,
    language_code,
    is_bot,
    is_active,
    notifications_enabled,
    first_seen_at,
    last_seen_at,
    created_at,
    updated_at,
    platform_metadata
)
SELECT 
    'slack'::platform_type as platform,
    COALESCE(NULLIF(TRIM(slack_user_id), ''), 'unknown_' || gen_random_uuid()::text) as platform_user_id,
    COALESCE(NULLIF(TRIM(slack_user_id), ''), 'unknown_user') as username,
    COALESCE(NULLIF(TRIM(slack_user_id), ''), 'Unknown User') as display_name,
    'en' as language_code,
    false as is_bot,
    true as is_active,
    true as notifications_enabled,
    COALESCE(first_seen_at, NOW()) as first_seen_at,
    COALESCE(first_seen_at, NOW()) as last_seen_at,
    COALESCE(first_seen_at, NOW()) as created_at,
    COALESCE(first_seen_at, NOW()) as updated_at,
    jsonb_build_object(
        'team_id', 'unknown',
        'migrated_from_reactions', true,
        'needs_profile_update', true,
        'original_slack_user_id', slack_user_id
    ) as platform_metadata
FROM temp_migration_users
WHERE slack_user_id IS NOT NULL
ON CONFLICT (platform, platform_user_id) DO UPDATE SET
    first_seen_at = LEAST(users.first_seen_at, EXCLUDED.first_seen_at),
    updated_at = GREATEST(users.updated_at, EXCLUDED.updated_at),
    platform_metadata = users.platform_metadata || jsonb_build_object(
        'migration_updated', NOW(),
        'conflict_resolved', true
    );

-- Log user migration results
DO $$
DECLARE
    user_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO user_count FROM users WHERE platform = 'slack';
    RAISE NOTICE 'Successfully migrated % users to centralized users table', user_count;
END
$$;

-- ============================================
-- STEP 3: ANALYZE OLD CONVERSATIONS
-- ============================================

-- Create temp table to analyze conversations and try to map them to users
DO $$
DECLARE
    schema_info RECORD;
BEGIN
    SELECT * INTO schema_info FROM temp_schema_info;
    
    IF schema_info.has_message_reactions AND schema_info.has_slack_user_id THEN
        -- Use message reactions to infer conversation users
        CREATE TEMP TABLE temp_conversation_analysis AS
        WITH conversation_messages AS (
            SELECT DISTINCT
                c.id as conversation_id,
                c.created_at as conversation_created_at,
                COALESCE(
                    (SELECT DISTINCT mr.slack_user_id 
                     FROM message_reactions mr 
                     JOIN messages m ON m.id = mr.message_id 
                     WHERE m.conversation_id = c.id 
                     LIMIT 1),
                    'unknown_user'
                ) as inferred_slack_user_id
            FROM conversations c
        )
        SELECT 
            conversation_id,
            conversation_created_at,
            inferred_slack_user_id,
            CASE 
                WHEN inferred_slack_user_id = 'unknown_user' THEN NULL
                ELSE (SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = inferred_slack_user_id)
            END as user_id
        FROM conversation_messages;
    ELSE
        -- Fallback: Map all conversations to default user
        CREATE TEMP TABLE temp_conversation_analysis AS
        SELECT DISTINCT
            c.id as conversation_id,
            c.created_at as conversation_created_at,
            'unknown_user' as inferred_slack_user_id,
            (SELECT id FROM users WHERE platform = 'slack' LIMIT 1) as user_id
        FROM conversations c;
    END IF;
END
$$;

-- Log conversation analysis results
DO $$
DECLARE
    total_conversations INTEGER;
    mapped_conversations INTEGER;
    unmapped_conversations INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_conversations FROM temp_conversation_analysis;
    SELECT COUNT(*) INTO mapped_conversations FROM temp_conversation_analysis WHERE user_id IS NOT NULL;
    SELECT COUNT(*) INTO unmapped_conversations FROM temp_conversation_analysis WHERE user_id IS NULL;
    
    RAISE NOTICE 'Conversation analysis: % total, % mapped to users, % unmapped', 
        total_conversations, mapped_conversations, unmapped_conversations;
END
$$;

-- ============================================
-- STEP 4: CREATE DEFAULT USER FOR ORPHANED DATA
-- ============================================

-- Create a default user for conversations/messages that can't be mapped to a real user
INSERT INTO users (
    platform,
    platform_user_id,
    username,
    display_name,
    language_code,
    is_bot,
    is_active,
    notifications_enabled,
    created_at,
    updated_at,
    platform_metadata
) VALUES (
    'slack'::platform_type,
    'MIGRATION_UNKNOWN_USER',
    'unknown_user',
    'Unknown User (Migration)',
    'en',
    false,
    false, -- Mark as inactive since it's not a real user
    false,
    NOW(),
    NOW(),
    jsonb_build_object(
        'is_migration_placeholder', true,
        'created_reason', 'Placeholder for orphaned conversations/messages during migration'
    )
) ON CONFLICT (platform, platform_user_id) DO NOTHING;

-- Get the default user ID
DO $$
DECLARE
    default_user_id UUID;
BEGIN
    SELECT id INTO default_user_id 
    FROM users 
    WHERE platform = 'slack' AND platform_user_id = 'MIGRATION_UNKNOWN_USER';
    
    -- Store in a temporary table for use in subsequent steps
    CREATE TEMP TABLE temp_default_user AS 
    SELECT default_user_id as id;
    
    RAISE NOTICE 'Created default user for orphaned data: %', default_user_id;
END
$$;

-- ============================================
-- STEP 5: MIGRATE CONVERSATIONS (DYNAMIC SCHEMA)
-- ============================================

-- Create enum types if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'conversation_status') THEN
        CREATE TYPE conversation_status AS ENUM ('active', 'archived', 'deleted');
    END IF;
END
$$;

-- Update conversations table to match new schema
-- Add new columns if they don't exist (for iterative migration)
DO $$
BEGIN
    -- Add user_id column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'user_id') THEN
        ALTER TABLE conversations ADD COLUMN user_id UUID;
    END IF;
    
    -- Add platform column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'platform') THEN
        ALTER TABLE conversations ADD COLUMN platform platform_type DEFAULT 'slack';
    END IF;
    
    -- Add status column with proper default
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'status') THEN
        ALTER TABLE conversations ADD COLUMN status conversation_status DEFAULT 'active';
    END IF;
    
    -- Add all other new columns with safe defaults
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'title') THEN
        ALTER TABLE conversations ADD COLUMN title TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'archived_at') THEN
        ALTER TABLE conversations ADD COLUMN archived_at TIMESTAMP WITH TIME ZONE;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'channel_id') THEN
        ALTER TABLE conversations ADD COLUMN channel_id TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'channel_name') THEN
        ALTER TABLE conversations ADD COLUMN channel_name TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'thread_id') THEN
        ALTER TABLE conversations ADD COLUMN thread_id TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'is_group_chat') THEN
        ALTER TABLE conversations ADD COLUMN is_group_chat BOOLEAN DEFAULT false;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'is_dm') THEN
        ALTER TABLE conversations ADD COLUMN is_dm BOOLEAN DEFAULT false;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'last_activity_at') THEN
        ALTER TABLE conversations ADD COLUMN last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'message_count') THEN
        ALTER TABLE conversations ADD COLUMN message_count INTEGER DEFAULT 0;
    END IF;
    
    -- FIXED: Ensure updated_at column exists and has proper default
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'updated_at') THEN
        ALTER TABLE conversations ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'platform_metadata') THEN
        ALTER TABLE conversations ADD COLUMN platform_metadata JSONB DEFAULT '{}'::jsonb;
    END IF;
    
    RAISE NOTICE 'Added new columns to conversations table';
END
$$;

-- Update conversations with mapped user data
UPDATE conversations 
SET 
    user_id = COALESCE(tca.user_id, (SELECT id FROM temp_default_user)),
    platform = 'slack'::platform_type,
    status = 'active'::conversation_status,
    last_activity_at = COALESCE(conversations.updated_at, conversations.created_at, NOW()),
    updated_at = COALESCE(conversations.updated_at, conversations.created_at, NOW()),
    platform_metadata = jsonb_build_object(
        'migrated_from_old_schema', true,
        'had_user_mapping', (tca.user_id IS NOT NULL),
        'inferred_slack_user_id', tca.inferred_slack_user_id
    )
FROM temp_conversation_analysis tca
WHERE conversations.id = tca.conversation_id;

-- Validate data before setting constraints
DO $$
DECLARE
    null_user_ids INTEGER;
    null_platforms INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_user_ids FROM conversations WHERE user_id IS NULL;
    SELECT COUNT(*) INTO null_platforms FROM conversations WHERE platform IS NULL;
    
    IF null_user_ids > 0 THEN
        RAISE EXCEPTION 'Cannot set user_id NOT NULL: % conversations have NULL user_id', null_user_ids;
    END IF;
    
    IF null_platforms > 0 THEN
        RAISE EXCEPTION 'Cannot set platform NOT NULL: % conversations have NULL platform', null_platforms;
    END IF;
    
    -- Safe to set constraints now
    ALTER TABLE conversations ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE conversations ALTER COLUMN platform SET NOT NULL;
    
    -- Add foreign key constraint if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = 'fk_conversations_user_id') THEN
        ALTER TABLE conversations ADD CONSTRAINT fk_conversations_user_id 
            FOREIGN KEY (user_id) REFERENCES users(id);
    END IF;
    
    RAISE NOTICE 'Set NOT NULL constraints and foreign key on conversations table';
END
$$;

-- ============================================
-- STEP 6: MIGRATE MESSAGES TO NEW TABLES
-- ============================================

-- Create required enums
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_status') THEN
        CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'read', 'failed');
    END IF;
END
$$;

-- Create user_queries table if not exists
CREATE TABLE IF NOT EXISTS user_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    platform_message_id TEXT,
    has_attachments BOOLEAN DEFAULT false,
    attachment_urls TEXT[],
    message_type TEXT DEFAULT 'text',
    status message_status DEFAULT 'sent',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    platform_metadata JSONB DEFAULT '{}'::jsonb
);

-- Create bot_responses table if not exists
CREATE TABLE IF NOT EXISTS bot_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id UUID NOT NULL REFERENCES user_queries(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    platform_message_id TEXT,
    model_used TEXT DEFAULT 'gemini-2.0-flash',
    tokens_used INTEGER,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    processing_time_ms INTEGER,
    has_attachments BOOLEAN DEFAULT false,
    attachment_urls TEXT[],
    response_type TEXT DEFAULT 'text',
    error_message TEXT,
    error_code TEXT,
    retry_count INTEGER DEFAULT 0,
    status message_status DEFAULT 'sent',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    platform_metadata JSONB DEFAULT '{}'::jsonb
);

-- Migrate user queries with new UUIDs
CREATE TEMP TABLE temp_old_message_to_new_query AS
SELECT 
    m.id as old_message_id,
    gen_random_uuid() as new_query_id
FROM messages m
WHERE m.message_type = 'user_query';

INSERT INTO user_queries (
    id,
    conversation_id,
    user_id,
    content,
    platform_message_id,
    has_attachments,
    message_type,
    status,
    created_at,
    updated_at,
    platform_metadata
)
SELECT 
    tmq.new_query_id,
    m.conversation_id,
    c.user_id,
    m.content,
    m.slack_message_ts,
    false as has_attachments,
    'text' as message_type,
    'sent'::message_status as status,
    m.created_at,
    m.created_at as updated_at,
    jsonb_build_object(
        'migrated_from_old_messages', true,
        'original_message_type', m.message_type,
        'original_message_id', m.id
    ) as platform_metadata
FROM messages m
JOIN conversations c ON m.conversation_id = c.id
JOIN temp_old_message_to_new_query tmq ON tmq.old_message_id = m.id
WHERE m.message_type = 'user_query'
  AND c.user_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Migrate bot responses with new UUIDs
CREATE TEMP TABLE temp_old_message_to_new_response AS
SELECT 
    m.id as old_message_id,
    gen_random_uuid() as new_response_id
FROM messages m
WHERE m.message_type = 'bot_response';

INSERT INTO bot_responses (
    id,
    query_id,
    conversation_id,
    content,
    platform_message_id,
    model_used,
    tokens_used,
    processing_time_ms,
    error_message,
    error_code,
    has_attachments,
    response_type,
    retry_count,
    status,
    created_at,
    updated_at,
    platform_metadata
)
SELECT 
    tmr.new_response_id,
    COALESCE(
        (SELECT tmq.new_query_id 
         FROM messages m_prev
         JOIN temp_old_message_to_new_query tmq ON tmq.old_message_id = m_prev.id
         WHERE m_prev.conversation_id = m.conversation_id 
         AND m_prev.message_type = 'user_query'
         AND m_prev.created_at < m.created_at 
         ORDER BY m_prev.created_at DESC 
         LIMIT 1),
        (SELECT id FROM user_queries 
         WHERE conversation_id = m.conversation_id 
         ORDER BY created_at ASC 
         LIMIT 1)
    ) as query_id,
    m.conversation_id,
    m.content,
    m.slack_message_ts,
    COALESCE(m.model_used, 'gemini-2.0-flash') as model_used,
    m.tokens_used,
    m.processing_time_ms,
    m.error_message,
    CASE 
        WHEN m.error_message IS NOT NULL THEN 'AI_GENERATION_ERROR'
        ELSE NULL 
    END as error_code,
    false as has_attachments,
    'text' as response_type,
    0 as retry_count,
    CASE 
        WHEN m.error_message IS NOT NULL THEN 'failed'::message_status
        ELSE 'sent'::message_status
    END as status,
    m.created_at,
    m.created_at as updated_at,
    jsonb_build_object(
        'migrated_from_old_messages', true,
        'original_message_type', m.message_type,
        'original_message_id', m.id,
        'had_error', (m.error_message IS NOT NULL)
    ) as platform_metadata
FROM messages m
JOIN conversations c ON m.conversation_id = c.id
JOIN temp_old_message_to_new_response tmr ON tmr.old_message_id = m.id
WHERE m.message_type = 'bot_response'
  AND c.user_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- STEP 7: MIGRATE MESSAGE REACTIONS (DYNAMIC)
-- ============================================

-- Update message_reactions table schema for centralized structure
DO $$
DECLARE
    schema_info RECORD;
BEGIN
    SELECT * INTO schema_info FROM temp_schema_info;
    
    IF schema_info.has_message_reactions THEN
        -- Create centralized message_reactions table if it doesn't exist
        CREATE TABLE IF NOT EXISTS message_reactions_new (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            response_id UUID NOT NULL REFERENCES bot_responses(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            reaction_name TEXT NOT NULL,
            reaction_unicode TEXT,
            platform platform_type NOT NULL DEFAULT 'slack',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            removed_at TIMESTAMP WITH TIME ZONE,
            CONSTRAINT unique_user_response_reaction UNIQUE (response_id, user_id, reaction_name)
        );
        
        IF schema_info.has_slack_user_id THEN
            -- Migrate existing reactions using slack_user_id mapping
            INSERT INTO message_reactions_new (
                response_id,
                user_id,
                reaction_name,
                reaction_unicode,
                platform,
                created_at
            )
            SELECT 
                tmr.new_response_id as response_id,
                u.id as user_id,
                mr.reaction_name,
                CASE mr.reaction_name
                    WHEN 'thumbsup' THEN '👍'
                    WHEN 'thumbsdown' THEN '👎'
                    WHEN 'heart' THEN '❤️'
                    WHEN 'fire' THEN '🔥'
                    WHEN 'eyes' THEN '👀'
                    WHEN 'rocket' THEN '🚀'
                    WHEN 'tada' THEN '🎉'
                    WHEN 'thinking_face' THEN '🤔'
                    WHEN 'confused' THEN '😕'
                    WHEN 'smile' THEN '😊'
                    ELSE NULL
                END as reaction_unicode,
                'slack'::platform_type as platform,
                mr.created_at
            FROM message_reactions mr
            JOIN users u ON u.platform = 'slack' AND u.platform_user_id = mr.slack_user_id
            JOIN messages m_old ON m_old.id = mr.message_id AND m_old.message_type = 'bot_response'
            JOIN temp_old_message_to_new_response tmr ON tmr.old_message_id = m_old.id
            WHERE mr.slack_user_id IS NOT NULL
              AND mr.reaction_name IS NOT NULL
            ON CONFLICT (response_id, user_id, reaction_name) DO UPDATE SET
                reaction_unicode = EXCLUDED.reaction_unicode,
                created_at = LEAST(message_reactions_new.created_at, EXCLUDED.created_at);
                
            RAISE NOTICE 'Migrated reactions using slack_user_id mapping';
        ELSE
            RAISE NOTICE 'No slack_user_id column found, skipping reaction migration';
        END IF;
        
        -- Replace old table with new one
        DROP TABLE IF EXISTS message_reactions CASCADE;
        ALTER TABLE message_reactions_new RENAME TO message_reactions;
        
    ELSE
        RAISE NOTICE 'No message_reactions table found, creating empty centralized table';
        
        CREATE TABLE IF NOT EXISTS message_reactions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            response_id UUID NOT NULL REFERENCES bot_responses(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            reaction_name TEXT NOT NULL,
            reaction_unicode TEXT,
            platform platform_type NOT NULL DEFAULT 'slack',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            removed_at TIMESTAMP WITH TIME ZONE,
            CONSTRAINT unique_user_response_reaction UNIQUE (response_id, user_id, reaction_name)
        );
    END IF;
END
$$;

-- ============================================
-- STEP 8: CREATE INDEXES FOR PERFORMANCE
-- ============================================

DO $$
BEGIN
    -- Users indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_platform_user_lookup') THEN
        CREATE INDEX idx_users_platform_user_lookup ON users(platform, platform_user_id);
    END IF;
    
    -- Conversations indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_conversations_user_platform') THEN
        CREATE INDEX idx_conversations_user_platform ON conversations(user_id, platform);
    END IF;
    
    -- User queries indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_user_queries_conversation_created') THEN
        CREATE INDEX idx_user_queries_conversation_created ON user_queries(conversation_id, created_at DESC);
    END IF;
    
    -- Bot responses indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_bot_responses_query_conversation') THEN
        CREATE INDEX idx_bot_responses_query_conversation ON bot_responses(query_id, conversation_id);
    END IF;
    
    RAISE NOTICE 'Migration-specific indexes created successfully';
END
$$;

-- ============================================
-- STEP 9: FINAL VALIDATION
-- ============================================

DO $$
DECLARE
    validation_errors TEXT[] := ARRAY[]::TEXT[];
    error_count INTEGER := 0;
    null_user_ids INTEGER;
    null_query_user_ids INTEGER;
    null_response_query_ids INTEGER;
    invalid_fk_conversations INTEGER;
    invalid_fk_queries INTEGER;
    invalid_fk_responses INTEGER;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '🔍 Running comprehensive validation checks...';
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    
    -- Check 1: All conversations have valid user_id
    SELECT COUNT(*) INTO null_user_ids FROM conversations WHERE user_id IS NULL;
    IF null_user_ids > 0 THEN
        validation_errors := array_append(validation_errors, 
            null_user_ids || ' conversations have NULL user_id');
        error_count := error_count + 1;
    END IF;
    
    -- Check 2: All user_queries have valid foreign keys
    SELECT COUNT(*) INTO null_query_user_ids 
    FROM user_queries WHERE conversation_id IS NULL OR user_id IS NULL;
    IF null_query_user_ids > 0 THEN
        validation_errors := array_append(validation_errors, 
            null_query_user_ids || ' user_queries have NULL foreign keys');
        error_count := error_count + 1;
    END IF;
    
    -- Check 3: All bot_responses have valid query_id
    SELECT COUNT(*) INTO null_response_query_ids 
    FROM bot_responses WHERE query_id IS NULL OR conversation_id IS NULL;
    IF null_response_query_ids > 0 THEN
        validation_errors := array_append(validation_errors, 
            null_response_query_ids || ' bot_responses have NULL foreign keys');
        error_count := error_count + 1;
    END IF;
    
    -- Check foreign key integrity
    SELECT COUNT(*) INTO invalid_fk_conversations
    FROM conversations c 
    LEFT JOIN users u ON c.user_id = u.id 
    WHERE u.id IS NULL;
    IF invalid_fk_conversations > 0 THEN
        validation_errors := array_append(validation_errors, 
            'Foreign key integrity violation: ' || invalid_fk_conversations || ' conversations->users');
        error_count := error_count + 1;
    END IF;
    
    SELECT COUNT(*) INTO invalid_fk_queries
    FROM user_queries uq
    LEFT JOIN conversations c ON uq.conversation_id = c.id
    LEFT JOIN users u ON uq.user_id = u.id
    WHERE c.id IS NULL OR u.id IS NULL;
    IF invalid_fk_queries > 0 THEN
        validation_errors := array_append(validation_errors, 
            'Foreign key integrity violation: ' || invalid_fk_queries || ' user_queries');
        error_count := error_count + 1;
    END IF;
    
    SELECT COUNT(*) INTO invalid_fk_responses
    FROM bot_responses br
    LEFT JOIN user_queries uq ON br.query_id = uq.id
    LEFT JOIN conversations c ON br.conversation_id = c.id
    WHERE uq.id IS NULL OR c.id IS NULL;
    IF invalid_fk_responses > 0 THEN
        validation_errors := array_append(validation_errors, 
            'Foreign key integrity violation: ' || invalid_fk_responses || ' bot_responses');
        error_count := error_count + 1;
    END IF;
    
    -- Report results
    RAISE NOTICE 'Validation Results:';
    RAISE NOTICE '  📊 Conversations: % (% with null user_id)', 
        (SELECT COUNT(*) FROM conversations), null_user_ids;
    RAISE NOTICE '  ❓ User Queries: % (% with null FKs)', 
        (SELECT COUNT(*) FROM user_queries), null_query_user_ids;
    RAISE NOTICE '  🤖 Bot Responses: % (% with null FKs)', 
        (SELECT COUNT(*) FROM bot_responses), null_response_query_ids;
    RAISE NOTICE '  👍 Reactions: %', 
        (SELECT COUNT(*) FROM message_reactions);
    
    -- Final verdict
    IF error_count = 0 THEN
        RAISE NOTICE '';
        RAISE NOTICE '✅ ✅ ✅ MIGRATION VALIDATION PASSED! ✅ ✅ ✅';
        RAISE NOTICE 'All integrity checks successful - migration is safe to commit!';
    ELSE
        RAISE NOTICE '';
        RAISE NOTICE '❌ ❌ ❌ MIGRATION VALIDATION FAILED! ❌ ❌ ❌';
        RAISE NOTICE 'Found % critical issues:', error_count;
        FOR i IN 1..array_length(validation_errors, 1) LOOP
            RAISE NOTICE '  🔥 %', validation_errors[i];
        END LOOP;
        RAISE EXCEPTION 'Migration validation failed! Please fix issues before proceeding.';
    END IF;
END
$$;

-- ============================================
-- STEP 10: MIGRATION SUMMARY
-- ============================================

DO $$
DECLARE
    summary_data RECORD;
BEGIN
    SELECT 
        (SELECT COUNT(*) FROM users WHERE platform = 'slack') as migrated_users,
        (SELECT COUNT(*) FROM conversations) as migrated_conversations,
        (SELECT COUNT(*) FROM user_queries) as migrated_queries,
        (SELECT COUNT(*) FROM bot_responses) as migrated_responses,
        (SELECT COUNT(*) FROM message_reactions) as migrated_reactions
    INTO summary_data;
    
    RAISE NOTICE '';
    RAISE NOTICE '🎉 🎉 🎉 MIGRATION COMPLETED SUCCESSFULLY! 🎉 🎉 🎉';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE 'Migration Summary:';
    RAISE NOTICE '  📊 Users migrated: %', summary_data.migrated_users;
    RAISE NOTICE '  💬 Conversations migrated: %', summary_data.migrated_conversations;
    RAISE NOTICE '  ❓ User queries migrated: %', summary_data.migrated_queries;
    RAISE NOTICE '  🤖 Bot responses migrated: %', summary_data.migrated_responses;
    RAISE NOTICE '  👍 Reactions migrated: %', summary_data.migrated_reactions;
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE '✅ MIGRATION IS PRODUCTION READY!';
    RAISE NOTICE '   - Dynamic schema detection implemented';
    RAISE NOTICE '   - Handles missing columns gracefully';
    RAISE NOTICE '   - Zero-error validation passed';
    RAISE NOTICE '   - All foreign key constraints validated';
END
$$;

-- Commit the transaction
COMMIT;

-- Post-migration verification queries
/*
-- Run these to verify migration success:

SELECT 'users' as table_name, COUNT(*) as count FROM users
UNION ALL SELECT 'conversations', COUNT(*) FROM conversations
UNION ALL SELECT 'user_queries', COUNT(*) FROM user_queries
UNION ALL SELECT 'bot_responses', COUNT(*) FROM bot_responses
UNION ALL SELECT 'message_reactions', COUNT(*) FROM message_reactions;

-- Check for any NULL foreign keys (should all return 0):
SELECT 'null_conversation_user_ids' as check_name, COUNT(*) FROM conversations WHERE user_id IS NULL
UNION ALL SELECT 'null_query_fks', COUNT(*) FROM user_queries WHERE conversation_id IS NULL OR user_id IS NULL
UNION ALL SELECT 'null_response_fks', COUNT(*) FROM bot_responses WHERE query_id IS NULL;
*/