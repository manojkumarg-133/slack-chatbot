-- ============================================
-- FIXES FOR MISSING UPDATED_AT IN STEP 7B AND 7C
-- Add these corrections to your script
-- ============================================

-- CORRECTION FOR STEP 7B: Add updated_at to user_queries migration
-- Replace the INSERT INTO user_queries section with this:

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
    updated_at,  -- ✅ ADDED: Missing field
    platform_metadata
)
SELECT 
    m.id,
    m.conversation_id,
    c.user_id,
    m.content,
    m.slack_message_ts,
    false as has_attachments,
    'text' as message_type,
    'sent'::message_status as status,
    m.created_at,
    m.created_at as updated_at,  -- ✅ ADDED: Use created_at as updated_at for migrated data
    jsonb_build_object(
        'migrated_from_old_messages', true,
        'original_message_type', m.message_type
    ) as platform_metadata
FROM messages m
JOIN conversations c ON m.conversation_id = c.id
WHERE m.message_type = 'user_query'
ON CONFLICT (id) DO NOTHING;

-- CORRECTION FOR STEP 7C: Add updated_at to bot_responses migration
-- Replace the INSERT INTO bot_responses section with this:

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
    updated_at,  -- ✅ ADDED: Missing field
    platform_metadata
)
SELECT 
    m.id,
    -- Your existing COALESCE query_id logic here...
    COALESCE(
        (SELECT uq.id 
         FROM user_queries uq
         WHERE uq.conversation_id = m.conversation_id 
         AND uq.created_at < m.created_at 
         AND (uq.platform_metadata->>'is_migration_placeholder' IS NULL 
              OR uq.platform_metadata->>'is_migration_placeholder' != 'true')
         ORDER BY uq.created_at DESC 
         LIMIT 1),
        (SELECT placeholder_query_id 
         FROM temp_orphaned_query_mapping 
         WHERE response_id = m.id),
        (SELECT uq.id 
         FROM user_queries uq 
         WHERE uq.conversation_id = m.conversation_id 
         AND uq.platform_metadata->>'original_response_id' = m.id::text),
        (SELECT uq.id 
         FROM user_queries uq 
         WHERE uq.conversation_id = m.conversation_id 
         ORDER BY uq.created_at ASC 
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
    NULL as error_code,
    false as has_attachments,
    'text' as response_type,
    0 as retry_count,
    CASE 
        WHEN m.error_message IS NOT NULL THEN 'failed'::message_status
        ELSE 'sent'::message_status
    END as status,
    m.created_at,
    m.created_at as updated_at,  -- ✅ ADDED: Use created_at as updated_at for migrated data
    jsonb_build_object(
        'migrated_from_old_messages', true,
        'original_message_type', m.message_type,
        'had_error', (m.error_message IS NOT NULL),
        'used_placeholder_query', EXISTS(
            SELECT 1 FROM temp_orphaned_query_mapping 
            WHERE response_id = m.id
        )
    ) as platform_metadata
FROM messages m
JOIN conversations c ON m.conversation_id = c.id
WHERE m.message_type = 'bot_response'
ON CONFLICT (id) DO NOTHING;

-- CORRECTION FOR STEP 7A: Add updated_at to placeholder queries
-- Update the placeholder query INSERT to include updated_at:

INSERT INTO user_queries (
    conversation_id,
    user_id,
    content,
    platform_message_id,
    has_attachments,
    message_type,
    status,
    created_at,
    updated_at,  -- ✅ ADDED: Missing field
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
    tor.created_at - INTERVAL '1 second' as updated_at,  -- ✅ ADDED: Same as created_at
    jsonb_build_object(
        'is_migration_placeholder', true,
        'reason', 'Orphaned bot response with no matching user query',
        'original_response_id', tor.id::text,
        'original_response_created_at', tor.created_at::text,
        'migration_timestamp', NOW()::text
    ) as platform_metadata
FROM temp_orphaned_responses tor
JOIN conversations c ON tor.conversation_id = c.id;