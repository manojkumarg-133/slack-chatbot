-- ============================================
-- MIGRATION SCRIPT: OLD SCHEMA → CENTRALIZED SCHEMA
-- ============================================
-- This script migrates data from the old single-platform schema
-- to the new centralized multi-platform schema
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
-- STEP 6: MIGRATE CONVERSATIONS
-- ============================================

-- Update conversations table to match new schema
-- Add new columns if they don't exist (for iterative migration)
DO $$
BEGIN
    -- Add user_id column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'user_id') THEN
        ALTER TABLE conversations ADD COLUMN user_id UUID REFERENCES users(id);
    END IF;
    
    -- Add platform column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'platform') THEN
        ALTER TABLE conversations ADD COLUMN platform platform_type DEFAULT 'slack';
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
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'platform_metadata') THEN
        ALTER TABLE conversations ADD COLUMN platform_metadata JSONB DEFAULT '{}'::jsonb;
    END IF;
    
    -- Add status column with proper default
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'status') THEN
        ALTER TABLE conversations ADD COLUMN status conversation_status DEFAULT 'active';
    END IF;
    
    -- Ensure updated_at column exists and has proper default
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'updated_at') THEN
        ALTER TABLE conversations ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
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
    last_activity_at = COALESCE(conversations.updated_at, conversations.created_at),
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
-- STEP 7: CREATE USER_QUERIES AND BOT_RESPONSES TABLES
-- ============================================

-- First, create a mapping table for proper query-response linking
CREATE TEMP TABLE temp_message_pairs AS
WITH numbered_messages AS (
    SELECT 
        m.*,
        ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at) as msg_number
    FROM messages m
),
query_response_pairs AS (
    SELECT 
        uq.id as query_id,
        uq.conversation_id,
        uq.created_at as query_time,
        br.id as response_id,
        br.created_at as response_time
    FROM numbered_messages uq
    JOIN numbered_messages br ON (
        uq.conversation_id = br.conversation_id
        AND uq.msg_number = br.msg_number - 1
        AND uq.message_type = 'user_query'
        AND br.message_type = 'bot_response'
        AND br.created_at > uq.created_at
        AND br.created_at <= uq.created_at + INTERVAL '10 minutes'
    )
)
SELECT * FROM query_response_pairs;

-- Split old messages table into user_queries and bot_responses  
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
    m.conversation_id,
    c.user_id,
    m.content,
    m.slack_message_ts,
    false as has_attachments, -- Old schema didn't track this
    'text' as message_type,
    'sent'::message_status as status,
    m.created_at,
    m.created_at as updated_at, -- Use same as created_at for migrated data
    jsonb_build_object(
        'migrated_from_old_messages', true,
        'original_message_type', m.message_type,
        'original_message_id', m.id
    ) as platform_metadata
FROM messages m
JOIN conversations c ON m.conversation_id = c.id
WHERE m.message_type = 'user_query'
  AND c.user_id IS NOT NULL; -- Only migrate if conversation has valid user

-- Create temporary mapping for old message IDs to new query IDs
CREATE TEMP TABLE temp_query_id_mapping AS
SELECT 
    m.id as old_message_id,
    uq.id as new_query_id
FROM messages m
JOIN user_queries uq ON (
    m.conversation_id = uq.conversation_id 
    AND m.created_at = uq.created_at
    AND m.content = uq.content
    AND m.slack_message_ts = uq.platform_message_id
)
WHERE m.message_type = 'user_query';

-- Insert bot responses with proper query_id linking
INSERT INTO bot_responses (
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
    COALESCE(
        tmp.query_id,
        -- Fallback: find closest preceding query in same conversation
        (SELECT uq.id FROM user_queries uq 
         WHERE uq.conversation_id = m.conversation_id 
         AND uq.created_at < m.created_at
         ORDER BY uq.created_at DESC 
         LIMIT 1),
        -- Last resort: use first query in conversation
        (SELECT uq.id FROM user_queries uq 
         WHERE uq.conversation_id = m.conversation_id
         ORDER BY uq.created_at ASC 
         LIMIT 1)
    ) as query_id,
    m.conversation_id,
    m.content,
    m.slack_message_ts,
    COALESCE(m.model_used, 'gemini-2.0-flash') as model_used,
    m.tokens_used,
    NULL as prompt_tokens, -- Old schema didn't separate these
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
    m.created_at as updated_at, -- Use same as created_at for migrated data
    jsonb_build_object(
        'migrated_from_old_messages', true,
        'original_message_type', m.message_type,
        'original_message_id', m.id,
        'had_error', (m.error_message IS NOT NULL)
    ) as platform_metadata
FROM messages m
JOIN conversations c ON m.conversation_id = c.id
LEFT JOIN temp_message_pairs tmp ON m.id = tmp.response_id
WHERE m.message_type = 'bot_response'
  AND c.user_id IS NOT NULL; -- Only migrate if conversation has valid user

-- Log message migration results
DO $$
DECLARE
    query_count INTEGER;
    response_count INTEGER;
    total_old_messages INTEGER;
BEGIN
    SELECT COUNT(*) INTO query_count FROM user_queries;
    SELECT COUNT(*) INTO response_count FROM bot_responses;
    SELECT COUNT(*) INTO total_old_messages FROM messages;
    
    RAISE NOTICE 'Messages migrated: % user queries, % bot responses (% total old messages)', 
        query_count, response_count, total_old_messages;
END
$$;

-- ============================================
-- STEP 8: MIGRATE MESSAGE REACTIONS
-- ============================================

-- Create temporary table to map old message_reactions to new structure
CREATE TEMP TABLE temp_reaction_mapping AS
SELECT DISTINCT
    mr.id as old_reaction_id,
    mr.reaction_name,
    mr.created_at,
    u.id as user_id,
    br.id as response_id,
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
-- Fix the join: map old message_id to new bot_responses via platform_message_id
JOIN messages old_msg ON old_msg.id = mr.message_id AND old_msg.message_type = 'bot_response'
JOIN bot_responses br ON (
    br.platform_message_id = old_msg.slack_message_ts
    AND br.conversation_id IN (
        SELECT id FROM conversations WHERE platform = 'slack'
    )
)
WHERE mr.slack_user_id IS NOT NULL
  AND mr.reaction_name IS NOT NULL;

-- Insert migrated reactions with proper conflict handling
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

-- Log reaction migration results
DO $$
DECLARE
    migrated_reactions INTEGER;
    total_old_reactions INTEGER;
    failed_reactions INTEGER;
BEGIN
    SELECT COUNT(*) INTO migrated_reactions FROM temp_reaction_mapping;
    SELECT COUNT(*) INTO total_old_reactions FROM message_reactions;
    failed_reactions := total_old_reactions - migrated_reactions;
    
    RAISE NOTICE 'Reactions migrated: % successful, % failed out of % total', 
        migrated_reactions, failed_reactions, total_old_reactions;
        
    IF failed_reactions > 0 THEN
        RAISE NOTICE 'Failed reactions likely due to missing user mappings or invalid message references';
    END IF;
END
$$;

-- ============================================
-- STEP 9: CREATE INDEXES FOR PERFORMANCE
-- ============================================

-- Indexes were already created in the main schema, but let's ensure they exist
DO $$
BEGIN
    -- Check and create critical indexes if they don't exist
    
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
-- STEP 10: UPDATE TRIGGERS AND FUNCTIONS
-- ============================================

-- Triggers were created in the main schema, but let's verify they're working
-- Update message counts for all conversations
DO $$
DECLARE
    conversation_record RECORD;
    actual_count INTEGER;
BEGIN
    FOR conversation_record IN SELECT id, message_count FROM conversations LOOP
        -- Count actual messages (queries + responses)
        SELECT 
            (SELECT COUNT(*) FROM user_queries WHERE conversation_id = conversation_record.id) +
            (SELECT COUNT(*) FROM bot_responses WHERE conversation_id = conversation_record.id)
        INTO actual_count;
        
        -- Update if different
        IF actual_count != conversation_record.message_count THEN
            UPDATE conversations 
            SET message_count = actual_count 
            WHERE id = conversation_record.id;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Message counts verified and corrected for all conversations';
END
$$;

-- ============================================
-- STEP 11: VALIDATION AND FINAL CHECKS
-- ============================================

-- Validate migration integrity
DO $$
DECLARE
    validation_errors TEXT[] := ARRAY[]::TEXT[];
    error_count INTEGER := 0;
BEGIN
    -- Check 1: All conversations have valid user_id
    IF EXISTS (SELECT 1 FROM conversations WHERE user_id IS NULL) THEN
        validation_errors := array_append(validation_errors, 'Some conversations have NULL user_id');
        error_count := error_count + 1;
    END IF;
    
    -- Check 2: All user_queries have valid conversation_id and user_id
    IF EXISTS (SELECT 1 FROM user_queries WHERE conversation_id IS NULL OR user_id IS NULL) THEN
        validation_errors := array_append(validation_errors, 'Some user_queries have NULL foreign keys');
        error_count := error_count + 1;
    END IF;
    
    -- Check 3: All bot_responses have valid query_id and conversation_id
    IF EXISTS (SELECT 1 FROM bot_responses WHERE query_id IS NULL OR conversation_id IS NULL) THEN
        validation_errors := array_append(validation_errors, 'Some bot_responses have NULL foreign keys');
        error_count := error_count + 1;
    END IF;
    
    -- Check 4: All message_reactions have valid response_id and user_id
    IF EXISTS (SELECT 1 FROM message_reactions WHERE response_id IS NULL OR user_id IS NULL) THEN
        validation_errors := array_append(validation_errors, 'Some message_reactions have NULL foreign keys');
        error_count := error_count + 1;
    END IF;
    
    -- Check 5: Foreign key integrity
    IF EXISTS (
        SELECT 1 FROM conversations c 
        LEFT JOIN users u ON c.user_id = u.id 
        WHERE u.id IS NULL
    ) THEN
        validation_errors := array_append(validation_errors, 'Foreign key integrity violation in conversations->users');
        error_count := error_count + 1;
    END IF;
    
    -- Report results
    IF error_count = 0 THEN
        RAISE NOTICE '✅ Migration validation passed! No integrity issues found.';
    ELSE
        RAISE NOTICE '❌ Migration validation found % issues:', error_count;
        FOR i IN 1..array_length(validation_errors, 1) LOOP
            RAISE NOTICE '  - %', validation_errors[i];
        END LOOP;
        RAISE EXCEPTION 'Migration validation failed. Please review and fix issues before proceeding.';
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
        (SELECT COUNT(*) FROM bot_responses) as migrated_responses,
        (SELECT COUNT(*) FROM message_reactions) as migrated_reactions,
        (SELECT COUNT(*) FROM users WHERE platform_user_id = 'MIGRATION_UNKNOWN_USER') as orphaned_data_users,
        (SELECT COUNT(*) FROM conversations c JOIN users u ON c.user_id = u.id 
         WHERE u.platform_user_id = 'MIGRATION_UNKNOWN_USER') as orphaned_conversations
    INTO summary_data;
    
    RAISE NOTICE '';
    RAISE NOTICE '🎉 MIGRATION COMPLETED SUCCESSFULLY! 🎉';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Migration Summary:';
    RAISE NOTICE '  📊 Users migrated: %', summary_data.migrated_users;
    RAISE NOTICE '  💬 Conversations migrated: %', summary_data.migrated_conversations;
    RAISE NOTICE '  ❓ User queries migrated: %', summary_data.migrated_queries;
    RAISE NOTICE '  🤖 Bot responses migrated: %', summary_data.migrated_responses;
    RAISE NOTICE '  👍 Reactions migrated: %', summary_data.migrated_reactions;
    RAISE NOTICE '  ⚠️  Orphaned conversations: %', summary_data.orphaned_conversations;
    RAISE NOTICE '================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Next Steps:';
    RAISE NOTICE '1. Update your application code to use the new schema';
    RAISE NOTICE '2. Test all functionality with the new database structure';
    RAISE NOTICE '3. Consider cleaning up orphaned data after testing';
    RAISE NOTICE '4. Update any remaining references to old table names';
    RAISE NOTICE '5. Drop old tables once migration is fully verified';
    RAISE NOTICE '';
END
$$;

-- Commit the transaction
COMMIT;

-- ============================================
-- POST-MIGRATION NOTES
-- ============================================

/*
🔧 POST-MIGRATION CLEANUP (Run separately after testing):

-- Drop old tables (ONLY after thorough testing)
-- DROP TABLE message_reactions CASCADE;
-- DROP TABLE messages CASCADE;
-- DROP TABLE old_conversations CASCADE; -- if you renamed it

-- Clean up orphaned data (ONLY if you're sure it's not needed)
-- DELETE FROM users WHERE platform_user_id = 'MIGRATION_UNKNOWN_USER';

🚨 ROLLBACK PLAN (if something goes wrong):

-- The transaction will automatically rollback if any step fails
-- But if you need to manually rollback after commit:

1. Restore from backup
2. Or manually reverse the migration:
   - Recreate old tables from backup
   - Drop new columns from conversations table
   - Clear user_queries and bot_responses tables
   - Restore original message_reactions structure

📋 TESTING CHECKLIST:

1. ✅ Verify user count matches expected users
2. ✅ Check conversation continuity 
3. ✅ Validate message history is complete
4. ✅ Test reaction functionality
5. ✅ Verify all foreign keys are properly linked
6. ✅ Test your application with new schema
7. ✅ Performance test with new indexes

⚠️ KNOWN LIMITATIONS:

1. Users created from reactions only - may need profile updates
2. Conversations without clear user mapping are assigned to default user
3. Query->Response linking is best-effort based on timestamps
4. Platform metadata is minimal - will be enriched as real data flows in
5. Message attachments/files are marked as false - update as needed

🔍 MONITORING QUERIES:

-- Check migration health
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

-- Find orphaned data
SELECT 'orphaned_conversations' as type, COUNT(*) as count
FROM conversations c 
JOIN users u ON c.user_id = u.id 
WHERE u.platform_user_id = 'MIGRATION_UNKNOWN_USER';
*/