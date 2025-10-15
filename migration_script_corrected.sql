-- ============================================
-- CORRECTED MIGRATION SCRIPT: OLD SCHEMA → CENTRALIZED SCHEMA
-- ============================================
-- This script migrates data from the old single-platform schema
-- to the new centralized multi-platform schema
-- 
-- FIXES APPLIED:
-- ✅ Proper UUID handling (no reuse)
-- ✅ Missing updated_at columns
-- ✅ Fixed foreign key constraints
-- ✅ Improved reaction mapping
-- ✅ Better error handling
-- ============================================

BEGIN;

-- ============================================
-- STEP 1: VERIFY OLD SCHEMA EXISTS
-- ============================================
DO $$
BEGIN
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

CREATE TEMP TABLE temp_migration_users AS
SELECT DISTINCT 
    slack_user_id,
    MIN(created_at) as first_seen_at
FROM message_reactions 
WHERE slack_user_id IS NOT NULL
  AND TRIM(slack_user_id) != ''
GROUP BY slack_user_id;

DO $$
DECLARE
    user_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO user_count FROM temp_migration_users;
    RAISE NOTICE 'Found % unique users from message reactions to migrate', user_count;
END
$$;

-- ============================================
-- STEP 3: MIGRATE USERS (FIXED)
-- ============================================

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

-- ============================================
-- STEP 4: ANALYZE OLD CONVERSATIONS
-- ============================================

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

-- ============================================
-- STEP 5: CREATE DEFAULT USER FOR ORPHANED DATA
-- ============================================

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
    false,
    false,
    NOW(),
    NOW(),
    jsonb_build_object(
        'is_migration_placeholder', true,
        'created_reason', 'Placeholder for orphaned conversations/messages during migration'
    )
) ON CONFLICT (platform, platform_user_id) DO NOTHING;

CREATE TEMP TABLE temp_default_user AS 
SELECT id FROM users WHERE platform = 'slack' AND platform_user_id = 'MIGRATION_UNKNOWN_USER';

-- ============================================
-- STEP 6: MIGRATE CONVERSATIONS (CORRECTED)
-- ============================================

DO $$
BEGIN
    -- Add all required columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'user_id') THEN
        ALTER TABLE conversations ADD COLUMN user_id UUID;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'platform') THEN
        ALTER TABLE conversations ADD COLUMN platform platform_type DEFAULT 'slack';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'status') THEN
        ALTER TABLE conversations ADD COLUMN status conversation_status DEFAULT 'active';
    END IF;
    
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
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'updated_at') THEN
        ALTER TABLE conversations ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'conversations' AND column_name = 'platform_metadata') THEN
        ALTER TABLE conversations ADD COLUMN platform_metadata JSONB DEFAULT '{}'::jsonb;
    END IF;
    
    RAISE NOTICE 'Added all required columns to conversations table';
END
$$;

-- Update conversations with mapped user data (FIXED: Added NOW() fallback)
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

-- Verify all rows have required data before setting NOT NULL constraints
DO $$
DECLARE
    null_user_id_count INTEGER;
    null_platform_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_user_id_count FROM conversations WHERE user_id IS NULL;
    SELECT COUNT(*) INTO null_platform_count FROM conversations WHERE platform IS NULL;
    
    IF null_user_id_count > 0 THEN
        RAISE EXCEPTION 'Cannot set user_id NOT NULL: % rows have NULL user_id', null_user_id_count;
    END IF;
    
    IF null_platform_count > 0 THEN
        RAISE EXCEPTION 'Cannot set platform NOT NULL: % rows have NULL platform', null_platform_count;
    END IF;
    
    -- Add foreign key constraint
    ALTER TABLE conversations ADD CONSTRAINT fk_conversations_user_id 
        FOREIGN KEY (user_id) REFERENCES users(id);
    
    -- Set NOT NULL constraints
    ALTER TABLE conversations ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE conversations ALTER COLUMN platform SET NOT NULL;
    
    RAISE NOTICE 'Set NOT NULL constraints and foreign keys on conversations table';
END
$$;

-- ============================================
-- STEP 7A: CREATE PLACEHOLDER QUERIES FOR ORPHANED RESPONSES
-- ============================================

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

DO $$
DECLARE
    orphaned_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphaned_count FROM temp_orphaned_responses;
    RAISE NOTICE 'Found % orphaned bot responses (no matching query)', orphaned_count;
END
$$;

-- Insert placeholder queries for orphaned responses (FIXED: Let PostgreSQL generate UUIDs)
INSERT INTO user_queries (
    conversation_id,
    user_id,
    content,
    platform_message_id,
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
    'text' as message_type,
    'sent'::message_status as status,
    tor.created_at - INTERVAL '1 second' as created_at,
    tor.created_at - INTERVAL '1 second' as updated_at,
    jsonb_build_object(
        'is_migration_placeholder', true,
        'reason', 'Orphaned bot response with no matching user query',
        'original_response_id', tor.id::text,
        'original_response_created_at', tor.created_at
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

-- ============================================
-- STEP 7B: MIGRATE USER QUERIES (FIXED: New UUIDs)
-- ============================================

-- Create mapping table for old message IDs to new query IDs
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
  AND c.user_id IS NOT NULL;

-- ============================================
-- STEP 7C: MIGRATE BOT RESPONSES (FIXED: New UUIDs + Proper Linking)
-- ============================================

-- Create mapping for bot responses
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
    tmr.new_response_id, -- FIXED: Use new UUID
    -- CORRECTED: Improved query linking
    COALESCE(
        -- Try to find matching query by old message ID mapping
        (SELECT tmq.new_query_id 
         FROM messages m_prev
         JOIN temp_old_message_to_new_query tmq ON tmq.old_message_id = m_prev.id
         WHERE m_prev.conversation_id = m.conversation_id 
         AND m_prev.message_type = 'user_query'
         AND m_prev.created_at < m.created_at 
         ORDER BY m_prev.created_at DESC 
         LIMIT 1),
        -- Use placeholder query for orphaned responses
        (SELECT placeholder_query_id 
         FROM temp_orphaned_query_mapping 
         WHERE response_id = m.id),
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
  AND c.user_id IS NOT NULL;

-- Validate all bot_responses have valid query_id
DO $$
DECLARE
    invalid_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO invalid_count FROM bot_responses WHERE query_id IS NULL;
    
    IF invalid_count > 0 THEN
        RAISE EXCEPTION 'Migration failed: % bot responses have NULL query_id', invalid_count;
    END IF;
    
    RAISE NOTICE 'All bot responses successfully linked to user queries';
END
$$;

-- ============================================
-- STEP 8: MIGRATE MESSAGE REACTIONS (FIXED)
-- ============================================

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

-- ============================================
-- STEP 9: UPDATE MESSAGE COUNTS (EFFICIENT)
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

-- ============================================
-- STEP 10: COMPREHENSIVE VALIDATION
-- ============================================

DO $$
DECLARE
    validation_errors TEXT[] := ARRAY[]::TEXT[];
    error_count INTEGER := 0;
    invalid_user_queries INTEGER;
    invalid_bot_responses INTEGER;
    invalid_reactions INTEGER;
    invalid_conversations INTEGER;
BEGIN
    -- Check conversations
    SELECT COUNT(*) INTO invalid_conversations
    FROM conversations c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE u.id IS NULL;
    
    IF invalid_conversations > 0 THEN
        validation_errors := array_append(validation_errors, invalid_conversations || ' conversations have invalid user_id');
        error_count := error_count + 1;
    END IF;
    
    -- Check user_queries
    SELECT COUNT(*) INTO invalid_user_queries
    FROM user_queries uq
    LEFT JOIN conversations c ON uq.conversation_id = c.id
    LEFT JOIN users u ON uq.user_id = u.id
    WHERE c.id IS NULL OR u.id IS NULL;
    
    IF invalid_user_queries > 0 THEN
        validation_errors := array_append(validation_errors, invalid_user_queries || ' user_queries have invalid foreign keys');
        error_count := error_count + 1;
    END IF;
    
    -- Check bot_responses
    SELECT COUNT(*) INTO invalid_bot_responses
    FROM bot_responses br
    LEFT JOIN user_queries uq ON br.query_id = uq.id
    LEFT JOIN conversations c ON br.conversation_id = c.id
    WHERE uq.id IS NULL OR c.id IS NULL;
    
    IF invalid_bot_responses > 0 THEN
        validation_errors := array_append(validation_errors, invalid_bot_responses || ' bot_responses have invalid foreign keys');
        error_count := error_count + 1;
    END IF;
    
    -- Check message_reactions
    SELECT COUNT(*) INTO invalid_reactions
    FROM message_reactions mr
    LEFT JOIN bot_responses br ON mr.response_id = br.id
    LEFT JOIN users u ON mr.user_id = u.id
    WHERE br.id IS NULL OR u.id IS NULL;
    
    IF invalid_reactions > 0 THEN
        validation_errors := array_append(validation_errors, invalid_reactions || ' message_reactions have invalid foreign keys');
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
-- STEP 11: GENERATE MIGRATION SUMMARY
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
         WHERE u.platform_user_id = 'MIGRATION_UNKNOWN_USER') as orphaned_conversations,
        (SELECT COUNT(*) FROM user_queries WHERE platform_metadata->>'is_migration_placeholder' = 'true') as placeholder_queries
    INTO summary_data;
    
    RAISE NOTICE '';
    RAISE NOTICE '🎉 CORRECTED MIGRATION COMPLETED SUCCESSFULLY! 🎉';
    RAISE NOTICE '====================================================';
    RAISE NOTICE 'Migration Summary:';
    RAISE NOTICE '  📊 Users migrated: %', summary_data.migrated_users;
    RAISE NOTICE '  💬 Conversations migrated: %', summary_data.migrated_conversations;
    RAISE NOTICE '  ❓ User queries migrated: %', summary_data.migrated_queries;
    RAISE NOTICE '  🤖 Bot responses migrated: %', summary_data.migrated_responses;
    RAISE NOTICE '  👍 Reactions migrated: %', summary_data.migrated_reactions;
    RAISE NOTICE '  ⚠️  Orphaned conversations: %', summary_data.orphaned_conversations;
    RAISE NOTICE '  🔧 Placeholder queries created: %', summary_data.placeholder_queries;
    RAISE NOTICE '====================================================';
    RAISE NOTICE '';
    RAISE NOTICE '✅ FIXES APPLIED:';
    RAISE NOTICE '  - Proper UUID generation (no reuse)';
    RAISE NOTICE '  - Added missing updated_at columns';
    RAISE NOTICE '  - Fixed foreign key constraints';
    RAISE NOTICE '  - Improved reaction mapping';
    RAISE NOTICE '  - Better error handling and validation';
    RAISE NOTICE '';
END
$$;

COMMIT;

/*
📋 KEY CORRECTIONS MADE:

✅ FIXED: UUID Reuse
   - Now generates new UUIDs for new tables instead of reusing old message IDs
   - Maintains proper mapping through temp tables

✅ FIXED: Missing updated_at Columns
   - Added updated_at to all INSERT statements
   - Proper timestamp handling with NOW() fallbacks

✅ FIXED: Foreign Key Constraints
   - Validates data before setting NOT NULL constraints
   - Adds proper foreign key relationships

✅ FIXED: Reaction Mapping
   - Uses new response IDs instead of old message IDs
   - Proper emoji Unicode mapping

✅ IMPROVED: Error Handling
   - Comprehensive validation at each step
   - Better error messages with specific counts
   - Transaction safety with proper rollback

🔍 VALIDATION: Run these queries after migration:

-- Check data integrity
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

-- Check foreign key integrity
SELECT 
    'orphaned_queries' as type,
    COUNT(*) as count
FROM user_queries uq
LEFT JOIN conversations c ON uq.conversation_id = c.id
WHERE c.id IS NULL;
*/