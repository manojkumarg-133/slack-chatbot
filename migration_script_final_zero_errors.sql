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
-- ✅ Improved reaction mapping
-- ✅ Comprehensive validation
-- ✅ Production-ready error handling
--
-- IMPORTANT: Run this script in a transaction and test thoroughly
-- BACKUP YOUR DATABASE BEFORE RUNNING THIS SCRIPT
-- ============================================

BEGIN;

-- ============================================
-- STEP 1: VERIFY OLD SCHEMA EXISTS
-- ============================================
DO $$
BEGIN
    -- Check if old tables exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
        RAISE EXCEPTION 'Old "messages" table not found. Migration cannot proceed.';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conversations') THEN
        RAISE EXCEPTION 'Old "conversations" table not found. Migration cannot proceed.';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'message_reactions') THEN
        RAISE EXCEPTION 'Old "message_reactions" table not found. Migration cannot proceed.';
    END IF;
    
    RAISE NOTICE 'Old schema tables verified. Starting migration...';
END
$$;

-- ============================================
-- STEP 2: CREATE TEMPORARY MIGRATION TABLES
-- ============================================

-- Temporary table to map old message_reactions to users
CREATE TEMP TABLE temp_migration_users AS
SELECT DISTINCT 
    slack_user_id,
    MIN(created_at) as first_seen_at
FROM message_reactions 
WHERE slack_user_id IS NOT NULL
  AND TRIM(slack_user_id) != ''
GROUP BY slack_user_id;

-- Log user creation progress
DO $$
DECLARE
    user_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO user_count FROM temp_migration_users;
    RAISE NOTICE 'Found % unique users from message reactions to migrate', user_count;
END
$$;

-- ============================================
-- STEP 3: MIGRATE USERS
-- ============================================

-- Create users from Slack user IDs found in message_reactions
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
-- STEP 4: ANALYZE OLD CONVERSATIONS
-- ============================================

-- Create temp table to analyze conversations and try to map them to users
CREATE TEMP TABLE temp_conversation_analysis AS
WITH conversation_messages AS (
    -- Get first message from each conversation to try to infer user
    SELECT DISTINCT
        c.id as conversation_id,
        c.created_at as conversation_created_at,
        -- Try to find a user from message reactions in this conversation
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
-- STEP 5: CREATE DEFAULT USER FOR ORPHANED DATA
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
-- STEP 6: MIGRATE CONVERSATIONS (FIXED)
-- ============================================

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
    
    -- Add title column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'title') THEN
        ALTER TABLE conversations ADD COLUMN title TEXT;
    END IF;
    
    -- Add archived_at column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'archived_at') THEN
        ALTER TABLE conversations ADD COLUMN archived_at TIMESTAMP WITH TIME ZONE;
    END IF;
    
    -- Add other new columns with defaults
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

-- FIXED: Update conversations with mapped user data with proper NOW() fallbacks
UPDATE conversations 
SET 
    user_id = COALESCE(tca.user_id, (SELECT id FROM temp_default_user)),
    platform = 'slack'::platform_type,
    status = 'active'::conversation_status,
    -- FIXED: Add NOW() as final fallback for both timestamps
    last_activity_at = COALESCE(conversations.updated_at, conversations.created_at, NOW()),
    updated_at = COALESCE(conversations.updated_at, conversations.created_at, NOW()),
    platform_metadata = jsonb_build_object(
        'migrated_from_old_schema', true,
        'had_user_mapping', (tca.user_id IS NOT NULL),
        'inferred_slack_user_id', tca.inferred_slack_user_id
    )
FROM temp_conversation_analysis tca
WHERE conversations.id = tca.conversation_id;

-- Count messages per conversation and update message_count efficiently
WITH message_counts AS (
    SELECT conversation_id, COUNT(*) as msg_count
    FROM messages 
    GROUP BY conversation_id
)
UPDATE conversations 
SET message_count = COALESCE(mc.msg_count, 0)
FROM message_counts mc
WHERE conversations.id = mc.conversation_id;

-- FIXED: Validate data before setting NOT NULL constraints
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
    
    -- Add foreign key constraint
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = 'fk_conversations_user_id') THEN
        ALTER TABLE conversations ADD CONSTRAINT fk_conversations_user_id 
            FOREIGN KEY (user_id) REFERENCES users(id);
    END IF;
    
    RAISE NOTICE 'Set NOT NULL constraints and foreign key on conversations table';
END
$$;

-- Log conversation migration results
DO $$
DECLARE
    conversation_count INTEGER;
    mapped_count INTEGER;
    orphaned_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO conversation_count FROM conversations;
    SELECT COUNT(*) INTO mapped_count 
    FROM conversations c 
    JOIN users u ON c.user_id = u.id 
    WHERE u.platform_user_id != 'MIGRATION_UNKNOWN_USER';
    SELECT COUNT(*) INTO orphaned_count 
    FROM conversations c 
    JOIN users u ON c.user_id = u.id 
    WHERE u.platform_user_id = 'MIGRATION_UNKNOWN_USER';
    
    RAISE NOTICE 'Conversations migrated: % total, % mapped to real users, % orphaned', 
        conversation_count, mapped_count, orphaned_count;
END
$$;

-- ============================================
-- STEP 7A: CREATE PLACEHOLDER QUERIES FOR ORPHANED RESPONSES
-- ============================================

-- Find bot responses that don't have a matching user query
CREATE TEMP TABLE temp_orphaned_responses AS
SELECT 
    m.id, 
    m.conversation_id, 
    m.content, 
    m.created_at
FROM messages m
WHERE m.message_type = 'bot_response'
AND NOT EXISTS (
    SELECT 1 FROM messages prev 
    WHERE prev.conversation_id = m.conversation_id 
    AND prev.message_type = 'user_query' 
    AND prev.created_at < m.created_at
);

-- Log orphaned responses
DO $$
DECLARE
    orphaned_count INTEGER;
    total_responses INTEGER;
    percentage NUMERIC;
BEGIN
    SELECT COUNT(*) INTO orphaned_count FROM temp_orphaned_responses;
    SELECT COUNT(*) INTO total_responses FROM messages WHERE message_type = 'bot_response';
    
    IF total_responses > 0 THEN
        percentage := ROUND((orphaned_count::NUMERIC / total_responses::NUMERIC) * 100, 2);
    ELSE
        percentage := 0;
    END IF;
    
    RAISE NOTICE 'Found % orphaned bot responses out of % total (%%)', 
        orphaned_count, total_responses, percentage;
        
    IF orphaned_count > 0 THEN
        RAISE NOTICE 'Creating placeholder queries for orphaned responses...';
    END IF;
END
$$;

-- FIXED: Insert placeholder queries for orphaned responses with updated_at
INSERT INTO user_queries (
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
    tor.conversation_id,
    c.user_id,
    '[Migration: No original query found]' as content,
    NULL as platform_message_id,
    false as has_attachments,
    'text' as message_type,
    'sent'::message_status as status,
    tor.created_at - INTERVAL '1 second' as created_at,
    tor.created_at - INTERVAL '1 second' as updated_at,
    jsonb_build_object(
        'is_migration_placeholder', true,
        'reason', 'Orphaned bot response with no matching user query',
        'original_response_id', tor.id::text,
        'original_response_created_at', tor.created_at::text,
        'migration_timestamp', NOW()::text
    ) as platform_metadata
FROM temp_orphaned_responses tor
JOIN conversations c ON tor.conversation_id = c.id;

-- Create mapping of orphaned responses to their placeholder queries
CREATE TEMP TABLE temp_orphaned_query_mapping AS
SELECT 
    tor.id as response_id,
    uq.id as placeholder_query_id
FROM temp_orphaned_responses tor
JOIN user_queries uq ON uq.conversation_id = tor.conversation_id
WHERE uq.platform_metadata->>'original_response_id' = tor.id::text;

-- Verify mapping was successful
DO $$
DECLARE
    orphaned_count INTEGER;
    mapped_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphaned_count FROM temp_orphaned_responses;
    SELECT COUNT(*) INTO mapped_count FROM temp_orphaned_query_mapping;
    
    IF orphaned_count != mapped_count THEN
        RAISE WARNING 'Mapping mismatch: % orphaned responses but only % mapped', 
            orphaned_count, mapped_count;
    ELSE
        RAISE NOTICE 'Successfully created % placeholder queries for orphaned responses', mapped_count;
    END IF;
END
$$;

-- ============================================
-- STEP 7B: MIGRATE USER QUERIES (FIXED - NEW UUIDS)
-- ============================================

-- Create mapping table for old message IDs to new query IDs (to avoid UUID reuse)
CREATE TEMP TABLE temp_old_message_to_new_query AS
SELECT 
    m.id as old_message_id,
    gen_random_uuid() as new_query_id
FROM messages m
WHERE m.message_type = 'user_query';

-- FIXED: Insert user queries with new UUIDs and updated_at
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
    tmq.new_query_id, -- FIXED: Use new UUID instead of old message ID
    m.conversation_id,
    c.user_id,
    m.content,
    m.slack_message_ts,
    false as has_attachments,
    'text' as message_type,
    'sent'::message_status as status,
    m.created_at,
    m.created_at as updated_at, -- FIXED: Added updated_at
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

-- Log user query migration
DO $$
DECLARE
    query_count INTEGER;
    placeholder_count INTEGER;
    total_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO query_count 
    FROM user_queries 
    WHERE platform_metadata->>'is_migration_placeholder' IS NULL 
       OR platform_metadata->>'is_migration_placeholder' != 'true';
    
    SELECT COUNT(*) INTO placeholder_count 
    FROM user_queries 
    WHERE platform_metadata->>'is_migration_placeholder' = 'true';
    
    total_count := query_count + placeholder_count;
    
    RAISE NOTICE 'User queries migrated: % real queries, % placeholder queries (% total)', 
        query_count, placeholder_count, total_count;
END
$$;

-- ============================================
-- STEP 7C: MIGRATE BOT RESPONSES (FIXED - NEW UUIDS + PROPER LINKING)
-- ============================================

-- Create mapping for bot responses (to avoid UUID reuse)
CREATE TEMP TABLE temp_old_message_to_new_response AS
SELECT 
    m.id as old_message_id,
    gen_random_uuid() as new_response_id
FROM messages m
WHERE m.message_type = 'bot_response';

-- FIXED: Insert bot responses with new UUIDs and guaranteed query_id linking
INSERT INTO bot_responses (
    id,
    query_id,
    conversation_id,
    content,
    platform_message_id,
    model_used,
    tokens_used,
    prompt_tokens,
    completion_tokens,
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
    tmr.new_response_id, -- FIXED: Use new UUID instead of old message ID
    -- FIXED: Improved query linking with guaranteed foreign key validity
    COALESCE(
        -- First: Try to find matching query by old message ID mapping
        (SELECT tmq.new_query_id 
         FROM messages m_prev
         JOIN temp_old_message_to_new_query tmq ON tmq.old_message_id = m_prev.id
         WHERE m_prev.conversation_id = m.conversation_id 
         AND m_prev.message_type = 'user_query'
         AND m_prev.created_at < m.created_at 
         ORDER BY m_prev.created_at DESC 
         LIMIT 1),
        -- Second: Use placeholder query for orphaned responses
        (SELECT placeholder_query_id 
         FROM temp_orphaned_query_mapping 
         WHERE response_id = m.id),
        -- Third: Get placeholder query by metadata match
        (SELECT id FROM user_queries 
         WHERE conversation_id = m.conversation_id 
         AND platform_metadata->>'original_response_id' = m.id::text),
        -- Last resort: ANY query from this conversation
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
    NULL as prompt_tokens,
    NULL as completion_tokens,
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
    m.created_at as updated_at, -- FIXED: Added updated_at
    jsonb_build_object(
        'migrated_from_old_messages', true,
        'original_message_type', m.message_type,
        'original_message_id', m.id,
        'had_error', (m.error_message IS NOT NULL),
        'used_placeholder_query', EXISTS(
            SELECT 1 FROM temp_orphaned_query_mapping 
            WHERE response_id = m.id
        )
    ) as platform_metadata
FROM messages m
JOIN conversations c ON m.conversation_id = c.id
JOIN temp_old_message_to_new_response tmr ON tmr.old_message_id = m.id
WHERE m.message_type = 'bot_response'
  AND c.user_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- CRITICAL VALIDATION: Ensure all bot_responses have valid query_id
DO $$
DECLARE
    invalid_count INTEGER;
    total_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_count FROM bot_responses;
    
    SELECT COUNT(*) INTO invalid_count FROM bot_responses WHERE query_id IS NULL;
    
    IF invalid_count > 0 THEN
        RAISE EXCEPTION 'MIGRATION FAILED: % out of % bot responses have NULL query_id!', 
            invalid_count, total_count;
    END IF;
    
    -- Verify foreign key integrity
    SELECT COUNT(*) INTO invalid_count
    FROM bot_responses br
    LEFT JOIN user_queries uq ON br.query_id = uq.id
    WHERE uq.id IS NULL;
    
    IF invalid_count > 0 THEN
        RAISE EXCEPTION 'MIGRATION FAILED: % bot responses reference non-existent user queries!', 
            invalid_count;
    END IF;
    
    RAISE NOTICE '✅ All % bot responses successfully linked to valid user queries', total_count;
END
$$;

-- ============================================
-- STEP 8: MIGRATE MESSAGE REACTIONS (FIXED)
-- ============================================

-- FIXED: Create temporary table with proper reaction mapping using new response IDs
CREATE TEMP TABLE temp_reaction_mapping AS
SELECT 
    mr.id as old_reaction_id,
    mr.reaction_name,
    mr.created_at,
    u.id as user_id,
    tmr.new_response_id as response_id, -- FIXED: Use new response ID
    'slack'::platform_type as platform,
    -- Add reaction_unicode mapping for common emojis
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
    END as reaction_unicode
FROM message_reactions mr
JOIN users u ON u.platform = 'slack' AND u.platform_user_id = mr.slack_user_id
JOIN messages m_old ON m_old.id = mr.message_id AND m_old.message_type = 'bot_response'
JOIN temp_old_message_to_new_response tmr ON tmr.old_message_id = m_old.id -- FIXED: Proper mapping
WHERE mr.slack_user_id IS NOT NULL
  AND mr.reaction_name IS NOT NULL;

-- Log what will be migrated vs what will be dropped
DO $$
DECLARE
    mappable_reactions INTEGER;
    total_reactions INTEGER;
    unmappable_reactions INTEGER;
    reactions_on_queries INTEGER;
BEGIN
    SELECT COUNT(*) INTO mappable_reactions FROM temp_reaction_mapping;
    SELECT COUNT(*) INTO total_reactions FROM message_reactions;
    unmappable_reactions := total_reactions - mappable_reactions;
    
    -- Count reactions on user queries (invalid in new schema)
    SELECT COUNT(*) INTO reactions_on_queries
    FROM message_reactions mr
    JOIN messages m ON m.id = mr.message_id
    WHERE m.message_type = 'user_query';
    
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE 'Reaction Migration Analysis:';
    RAISE NOTICE '  Total reactions in old schema: %', total_reactions;
    RAISE NOTICE '  Mappable to new schema: %', mappable_reactions;
    RAISE NOTICE '  Unmappable (will be dropped): %', unmappable_reactions;
    RAISE NOTICE '  └─ Reactions on user queries: %', reactions_on_queries;
    RAISE NOTICE '  └─ Missing user/message mappings: %', unmappable_reactions - reactions_on_queries;
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    
    IF reactions_on_queries > 0 THEN
        RAISE NOTICE '⚠️  Note: Reactions on user queries are invalid in the new schema';
        RAISE NOTICE '   and will be dropped (new schema only allows reactions on bot responses)';
    END IF;
END
$$;

-- Insert migrated reactions
INSERT INTO message_reactions (
    response_id,
    user_id,
    reaction_name,
    reaction_unicode,
    platform,
    created_at
)
SELECT 
    response_id,
    user_id,
    reaction_name,
    reaction_unicode,
    platform,
    created_at
FROM temp_reaction_mapping
ON CONFLICT (response_id, user_id, reaction_name) DO UPDATE SET
    reaction_unicode = EXCLUDED.reaction_unicode,
    created_at = LEAST(message_reactions.created_at, EXCLUDED.created_at);

-- Log final reaction migration results
DO $$
DECLARE
    migrated_reactions INTEGER;
BEGIN
    SELECT COUNT(*) INTO migrated_reactions FROM message_reactions;
    RAISE NOTICE '✅ Successfully migrated % reactions to new schema', migrated_reactions;
END
$$;

-- ============================================
-- STEP 9: UPDATE MESSAGE COUNTS (EFFICIENT BATCH UPDATE)
-- ============================================

-- Batch update all message counts efficiently
WITH message_counts AS (
    SELECT 
        conversation_id,
        COUNT(*) as total_messages
    FROM (
        SELECT conversation_id FROM user_queries
        UNION ALL
        SELECT conversation_id FROM bot_responses
    ) combined_messages
    GROUP BY conversation_id
)
UPDATE conversations c
SET 
    message_count = COALESCE(mc.total_messages, 0),
    last_activity_at = GREATEST(
        c.last_activity_at,
        COALESCE(
            (SELECT MAX(created_at) FROM user_queries WHERE conversation_id = c.id),
            c.created_at
        ),
        COALESCE(
            (SELECT MAX(created_at) FROM bot_responses WHERE conversation_id = c.id),
            c.created_at
        )
    )
FROM message_counts mc
WHERE c.id = mc.conversation_id;

-- Set message_count to 0 for conversations with no messages
UPDATE conversations SET message_count = 0 WHERE message_count IS NULL;

-- Log completion of message count updates
DO $$
BEGIN
    RAISE NOTICE 'Message counts and timestamps updated for all conversations';
END
$$;

-- ============================================
-- STEP 10: CREATE INDEXES FOR PERFORMANCE
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
-- STEP 11: COMPREHENSIVE VALIDATION (ZERO ERRORS GUARANTEED)
-- ============================================

DO $$
DECLARE
    validation_errors TEXT[] := ARRAY[]::TEXT[];
    error_count INTEGER := 0;
    
    -- Counters
    null_user_ids INTEGER;
    null_query_user_ids INTEGER;
    null_response_query_ids INTEGER;
    null_reaction_ids INTEGER;
    invalid_fk_conversations INTEGER;
    invalid_fk_queries INTEGER;
    invalid_fk_responses INTEGER;
    invalid_fk_reactions INTEGER;
    conversations_without_updated_at INTEGER;
    conversations_without_last_activity INTEGER;
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
    
    -- Check 2: All user_queries have valid conversation_id and user_id
    SELECT COUNT(*) INTO null_query_user_ids 
    FROM user_queries WHERE conversation_id IS NULL OR user_id IS NULL;
    IF null_query_user_ids > 0 THEN
        validation_errors := array_append(validation_errors, 
            null_query_user_ids || ' user_queries have NULL foreign keys');
        error_count := error_count + 1;
    END IF;
    
    -- Check 3: All bot_responses have valid query_id and conversation_id
    SELECT COUNT(*) INTO null_response_query_ids 
    FROM bot_responses WHERE query_id IS NULL OR conversation_id IS NULL;
    IF null_response_query_ids > 0 THEN
        validation_errors := array_append(validation_errors, 
            null_response_query_ids || ' bot_responses have NULL foreign keys');
        error_count := error_count + 1;
    END IF;
    
    -- Check 4: All message_reactions have valid response_id and user_id
    SELECT COUNT(*) INTO null_reaction_ids 
    FROM message_reactions WHERE response_id IS NULL OR user_id IS NULL;
    IF null_reaction_ids > 0 THEN
        validation_errors := array_append(validation_errors, 
            null_reaction_ids || ' message_reactions have NULL foreign keys');
        error_count := error_count + 1;
    END IF;
    
    -- Check 5: Foreign key integrity - conversations->users
    SELECT COUNT(*) INTO invalid_fk_conversations
    FROM conversations c 
    LEFT JOIN users u ON c.user_id = u.id 
    WHERE u.id IS NULL;
    IF invalid_fk_conversations > 0 THEN
        validation_errors := array_append(validation_errors, 
            'Foreign key integrity violation: ' || invalid_fk_conversations || ' conversations->users');
        error_count := error_count + 1;
    END IF;
    
    -- Check 6: Foreign key integrity - user_queries->conversations and users
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
    
    -- Check 7: Foreign key integrity - bot_responses->user_queries
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
    
    -- Check 8: Foreign key integrity - message_reactions->bot_responses and users
    SELECT COUNT(*) INTO invalid_fk_reactions
    FROM message_reactions mr
    LEFT JOIN bot_responses br ON mr.response_id = br.id
    LEFT JOIN users u ON mr.user_id = u.id
    WHERE br.id IS NULL OR u.id IS NULL;
    IF invalid_fk_reactions > 0 THEN
        validation_errors := array_append(validation_errors, 
            'Foreign key integrity violation: ' || invalid_fk_reactions || ' message_reactions');
        error_count := error_count + 1;
    END IF;
    
    -- Check 9: All conversations have updated_at and last_activity_at
    SELECT COUNT(*) INTO conversations_without_updated_at 
    FROM conversations WHERE updated_at IS NULL;
    IF conversations_without_updated_at > 0 THEN
        validation_errors := array_append(validation_errors, 
            conversations_without_updated_at || ' conversations missing updated_at');
        error_count := error_count + 1;
    END IF;
    
    SELECT COUNT(*) INTO conversations_without_last_activity 
    FROM conversations WHERE last_activity_at IS NULL;
    IF conversations_without_last_activity > 0 THEN
        validation_errors := array_append(validation_errors, 
            conversations_without_last_activity || ' conversations missing last_activity_at');
        error_count := error_count + 1;
    END IF;
    
    -- Report detailed results
    RAISE NOTICE 'Validation Results:';
    RAISE NOTICE '  📊 Conversations: % (% with null user_id)', 
        (SELECT COUNT(*) FROM conversations), null_user_ids;
    RAISE NOTICE '  ❓ User Queries: % (% with null FKs)', 
        (SELECT COUNT(*) FROM user_queries), null_query_user_ids;
    RAISE NOTICE '  🤖 Bot Responses: % (% with null FKs)', 
        (SELECT COUNT(*) FROM bot_responses), null_response_query_ids;
    RAISE NOTICE '  👍 Reactions: % (% with null FKs)', 
        (SELECT COUNT(*) FROM message_reactions), null_reaction_ids;
    RAISE NOTICE '  🔗 Foreign Key Violations: % total', 
        (invalid_fk_conversations + invalid_fk_queries + invalid_fk_responses + invalid_fk_reactions);
    
    -- Final verdict
    IF error_count = 0 THEN
        RAISE NOTICE '';
        RAISE NOTICE '✅ ✅ ✅ MIGRATION VALIDATION PASSED! ✅ ✅ ✅';
        RAISE NOTICE 'All integrity checks successful - migration is safe to commit!';
        RAISE NOTICE '';
    ELSE
        RAISE NOTICE '';
        RAISE NOTICE '❌ ❌ ❌ MIGRATION VALIDATION FAILED! ❌ ❌ ❌';
        RAISE NOTICE 'Found % critical issues:', error_count;
        FOR i IN 1..array_length(validation_errors, 1) LOOP
            RAISE NOTICE '  🔥 %', validation_errors[i];
        END LOOP;
        RAISE NOTICE '';
        RAISE EXCEPTION 'Migration validation failed! Please fix issues before proceeding.';
    END IF;
END
$$;

-- ============================================
-- STEP 12: GENERATE MIGRATION SUMMARY
-- ============================================

DO $$
DECLARE
    summary_data RECORD;
BEGIN
    SELECT 
        (SELECT COUNT(*) FROM users WHERE platform = 'slack') as migrated_users,
        (SELECT COUNT(*) FROM conversations) as migrated_conversations,
        (SELECT COUNT(*) FROM user_queries) as migrated_queries,
        (SELECT COUNT(*) FROM user_queries WHERE platform_metadata->>'is_migration_placeholder' = 'true') as placeholder_queries,
        (SELECT COUNT(*) FROM bot_responses) as migrated_responses,
        (SELECT COUNT(*) FROM message_reactions) as migrated_reactions,
        (SELECT COUNT(*) FROM users WHERE platform_user_id = 'MIGRATION_UNKNOWN_USER') as orphaned_data_users,
        (SELECT COUNT(*) FROM conversations c JOIN users u ON c.user_id = u.id 
         WHERE u.platform_user_id = 'MIGRATION_UNKNOWN_USER') as orphaned_conversations
    INTO summary_data;
    
    RAISE NOTICE '';
    RAISE NOTICE '🎉 🎉 🎉 MIGRATION COMPLETED SUCCESSFULLY! 🎉 🎉 🎉';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE 'Migration Summary:';
    RAISE NOTICE '  📊 Users migrated: %', summary_data.migrated_users;
    RAISE NOTICE '  💬 Conversations migrated: %', summary_data.migrated_conversations;
    RAISE NOTICE '  ❓ User queries migrated: % (% real + % placeholder)', 
        summary_data.migrated_queries, 
        summary_data.migrated_queries - summary_data.placeholder_queries,
        summary_data.placeholder_queries;
    RAISE NOTICE '  🤖 Bot responses migrated: %', summary_data.migrated_responses;
    RAISE NOTICE '  👍 Reactions migrated: %', summary_data.migrated_reactions;
    RAISE NOTICE '  ⚠️  Orphaned conversations: %', summary_data.orphaned_conversations;
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE '✅ ALL CRITICAL FIXES APPLIED:';
    RAISE NOTICE '  ✅ Proper UUID handling (no reuse conflicts)';
    RAISE NOTICE '  ✅ Complete updated_at columns added';
    RAISE NOTICE '  ✅ NOW() fallbacks in conversation updates';
    RAISE NOTICE '  ✅ Guaranteed foreign key integrity';
    RAISE NOTICE '  ✅ Comprehensive validation passed';
    RAISE NOTICE '  ✅ Efficient reaction mapping';
    RAISE NOTICE '  ✅ Production-ready error handling';
    RAISE NOTICE '';
    RAISE NOTICE '🚀 MIGRATION IS PRODUCTION READY!';
    RAISE NOTICE '';
    RAISE NOTICE 'Next Steps:';
    RAISE NOTICE '1. Test application with new schema';
    RAISE NOTICE '2. Update Edge Function to use new database helpers';
    RAISE NOTICE '3. Performance test with new indexes';
    RAISE NOTICE '4. Clean up orphaned data if needed';
    RAISE NOTICE '5. Drop old tables after thorough testing';
    RAISE NOTICE '';
END
$$;

-- Commit the transaction
COMMIT;

-- ============================================
-- POST-MIGRATION VERIFICATION QUERIES
-- ============================================

/*
🔍 VERIFICATION QUERIES - Run these after migration:

-- 1. Check all tables have data
SELECT 
    'users' as table_name, COUNT(*) as count 
FROM users WHERE platform = 'slack'
UNION ALL
SELECT 'conversations', COUNT(*) FROM conversations
UNION ALL  
SELECT 'user_queries', COUNT(*) FROM user_queries
UNION ALL
SELECT 'bot_responses', COUNT(*) FROM bot_responses
UNION ALL
SELECT 'message_reactions', COUNT(*) FROM message_reactions;

-- 2. Verify no NULL foreign keys
SELECT 
    'conversations_null_user_id' as check_name,
    COUNT(*) as violations
FROM conversations WHERE user_id IS NULL
UNION ALL
SELECT 'queries_null_fks', COUNT(*) 
FROM user_queries WHERE conversation_id IS NULL OR user_id IS NULL
UNION ALL
SELECT 'responses_null_query_id', COUNT(*) 
FROM bot_responses WHERE query_id IS NULL
UNION ALL
SELECT 'reactions_null_fks', COUNT(*) 
FROM message_reactions WHERE response_id IS NULL OR user_id IS NULL;

-- 3. Check placeholder queries created
SELECT 
    COUNT(*) as placeholder_queries,
    COUNT(DISTINCT conversation_id) as conversations_with_placeholders
FROM user_queries 
WHERE platform_metadata->>'is_migration_placeholder' = 'true';

-- 4. Verify updated_at columns populated
SELECT 
    'conversations_with_updated_at' as metric,
    COUNT(*) as count
FROM conversations WHERE updated_at IS NOT NULL
UNION ALL
SELECT 'queries_with_updated_at', COUNT(*) 
FROM user_queries WHERE updated_at IS NOT NULL
UNION ALL
SELECT 'responses_with_updated_at', COUNT(*) 
FROM bot_responses WHERE updated_at IS NOT NULL;

-- 5. Check foreign key integrity
SELECT 
    'orphaned_conversations' as type, COUNT(*) as count
FROM conversations c
LEFT JOIN users u ON c.user_id = u.id
WHERE u.id IS NULL
UNION ALL
SELECT 'orphaned_queries', COUNT(*)
FROM user_queries uq
LEFT JOIN conversations c ON uq.conversation_id = c.id
WHERE c.id IS NULL
UNION ALL
SELECT 'orphaned_responses', COUNT(*)
FROM bot_responses br
LEFT JOIN user_queries uq ON br.query_id = uq.id
WHERE uq.id IS NULL
UNION ALL
SELECT 'orphaned_reactions', COUNT(*)
FROM message_reactions mr
LEFT JOIN bot_responses br ON mr.response_id = br.id
WHERE br.id IS NULL;

🎯 SUCCESS CRITERIA:
- All counts > 0 for main tables
- All violations = 0 for NULL foreign keys  
- All orphaned counts = 0 for foreign key integrity
- All tables have updated_at populated

✅ IF ALL CHECKS PASS: Your migration is successful and production-ready!
❌ IF ANY CHECKS FAIL: Review the specific issue and contact support.
*/